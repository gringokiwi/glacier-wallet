import express from 'express';
import * as bip39 from 'bip39';
import * as bitcoin from 'bitcoinjs-lib';
import * as bip32 from 'bip32';
import * as ecc from 'tiny-secp256k1';
import type { Request, Response } from 'express';
import { MempoolApiClient, Transaction } from './mempool';
import { MNEMONIC_PHRASE, Network, NETWORK, networkConfig } from './config';
import { GlacierHelper } from './glacier';

const bip32Instance = bip32.BIP32Factory(ecc);
const mempoolApi = new MempoolApiClient(NETWORK);
const glacier = new GlacierHelper(NETWORK)

type Address = {
  label: string;
  network: Network;
  address: string;
  path: string;
  index: number;
  used: boolean;
  balance: number;
  spendable: boolean;
  unlock_tx?: string;
}

const getAddresses = async (xpub: string, count: number): Promise<{
  addresses: Address[],
  newLockPsbt?: string,
  unlockPsbt?: string,
  unlockIndices?: number[]
}> => {
  const parent = bip32Instance.fromBase58(xpub);
  const config = networkConfig[NETWORK];

  const currentHeight = await mempoolApi.getCurrentHeight();
  const { psbt: newLockPsbt, lockAddress: newLockAddress } = glacier.createNewLockPsbt(currentHeight + 2, parent);
  const addresses = new Set<Address>();
  let lastAddress: Address | undefined;
  const transactions = new Set<Transaction>();

  // Loop over standard addresses, add any outputs to the new lock PSBT
  for (let i = 0; i < count; i++) {
    if (!lastAddress || (lastAddress && lastAddress.used)) {
      const changeIndex = 0; // TODO: Support change addresses
      const path = `${config.path}/${changeIndex}/${i}`;
      const p2wpkh = bitcoin.payments.p2wpkh({
        pubkey: parent.derive(changeIndex).derive(i).publicKey,
        network: config.network
      });

      if (!p2wpkh.address) throw new Error(`Failed to generate address for ${path}`);
      if (!p2wpkh.output) throw new Error(`Failed to get output script for ${path}`);
      const address = p2wpkh.address;

      const { used, balance } = await mempoolApi.getAddressBalance(address);

      let data: Address = {
        label: `Receive Address #${i} (${used ? 'Used' : 'New'})`,
        network: NETWORK,
        address,
        path,
        index: i,
        used,
        balance,
        spendable: true
      };

      if (!used) {
        lastAddress = data;
        addresses.add(data);
        continue;
      }

      if (balance) {
        const utxos = await mempoolApi.getAddressUtxos(address);
        for (const utxo of utxos) {
          newLockPsbt.addInput({
            hash: utxo.txid,
            index: utxo.vout,
            witnessUtxo: {
              script: p2wpkh.output,
              value: BigInt(utxo.value)
            }
          });
        }
      }

      const addressTxs = await mempoolApi.getAddressTransactions(address);

      for (const tx of addressTxs) {
        if (!glacier.isLockTransaction(tx)) continue;
        transactions.add(tx);
      }

      lastAddress = data;
      addresses.add(data);
    }
  }

  const unlockPsbt = new bitcoin.Psbt({ network: config.network });
  let unlockIndices = [];
  let unlockValue = 0n;

  // Loop over any GLACIER lock transactions found, add to glacierLocks set
  for (const tx of transactions) {
    const parsed = glacier.parseLockTransaction(tx, parent);
    if (!parsed) continue;
    const { lockHeight, lockAddress, redeemScript } = parsed;
    // Fetch balance for the lock address
    const { balance } = await mempoolApi.getAddressBalance(lockAddress);
    const changeIndex = 3;
    const path = `${config.path}/${changeIndex}/${lockHeight}`;
    const spendable = currentHeight >= lockHeight;
    const data: Address = {
      label: `Glacier Lock (${lockHeight}) - ${spendable ? 'Expired' : 'Active'}`,
      network: NETWORK,
      address: lockAddress,
      path,
      index: lockHeight,
      used: true,
      balance,
      spendable
    };
    addresses.add(data);

    // If the lock is spendable, add its UTXOs to the unlock PSBT
    if (balance && spendable) {
      const utxos = await mempoolApi.getAddressUtxos(lockAddress);
      for (const utxo of utxos) {
        const txHex = await mempoolApi.getTransactionHex(utxo.txid);
        unlockPsbt.addInput({
          hash: utxo.txid,
          index: utxo.vout,
          sequence: 0,
          nonWitnessUtxo: bitcoin.Transaction.fromHex(txHex).toBuffer(),
          redeemScript
        });
        unlockValue += BigInt(utxo.value);
        unlockIndices.push(lockHeight);
      }
      const newLockTime = Math.max(unlockPsbt.locktime ?? 0, lockHeight);
      unlockPsbt.setLocktime(newLockTime);
    }
  }

  let newLockPsbtHex: string | undefined;

  // Complete new lock PSBT if we have any inputs
  if (newLockPsbt.inputCount > 0) {
    const totalInput = newLockPsbt.data.inputs.reduce((sum, input) => sum + (input.witnessUtxo?.value || 0n), 0n);
    newLockPsbt.addOutput({
      address: newLockAddress,
      value: totalInput - 1000n
    });
    newLockPsbtHex = newLockPsbt.toHex();
  }

  let unlockPsbtHex: string | undefined;

  // Complete unlock PSBT if we have any inputs
  if (unlockPsbt.inputCount > 0) {
    const sweepAddress = Array.from(addresses).find(data => !data.used)?.address;
    if (!sweepAddress) throw new Error('No unused address available for sweeping GLACIER locks');
    const totalToSweep = unlockValue - 1000n;
    unlockPsbt.addOutput({
      address: sweepAddress,
      value: totalToSweep
    });
    unlockPsbtHex = unlockPsbt.toHex();
  }

  return {
    addresses: Array.from(addresses),
    newLockPsbt: newLockPsbtHex,
    unlockPsbt: unlockPsbtHex,
    unlockIndices: unlockIndices.length ? unlockIndices : undefined
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/addresses', async (req: Request, res: Response) => {
  const seed = bip39.mnemonicToSeedSync(MNEMONIC_PHRASE);
  const root = bip32Instance.fromSeed(seed);
  const config = networkConfig[NETWORK];
  const parent = root.derivePath(config.path);
  const xpub = parent.neutered().toBase58();

  try {
    const count = parseInt(req.query.count as string) || 10;
    let { addresses, newLockPsbt, unlockPsbt, unlockIndices } = await getAddresses(xpub, count);

    if (unlockPsbt && unlockIndices) {
      const psbt = bitcoin.Psbt.fromHex(unlockPsbt, { network: config.network });
      for (const [index, input] of psbt.data.inputs.entries()) {
        psbt.signInput(index, parent.derive(3).derive(unlockIndices[index]));
        psbt.finalizeInput(index, () => {
          const partialSig = input.partialSig?.[0];
          if (!partialSig) throw new Error('Missing signature');
          const pubKey = partialSig.pubkey;
          const signature = partialSig.signature;
          if (!input.redeemScript) throw new Error('Missing redeemScript');
          const finalScriptSig = bitcoin.script.compile([
            signature,
            pubKey,
            input.redeemScript,
          ]);
          return {
            finalScriptSig,
            finalScriptWitness: undefined
          };
        });
      }
      const tx = psbt.extractTransaction();
      await mempoolApi.broadcastTransaction(tx.toHex());
      addresses = addresses.map(address => {
        if (address.spendable && address.balance > 0) {
          return { ...address, balance: 0, unlock_tx: `https://mempool.space/testnet4/tx/${tx.getId()}` };
        }
        return address;
      })
    }

    res.send(`<html><pre>${JSON.stringify({
      xpub,
      addresses,
      newLockPsbt
    }, null, 2)}</pre></html>`);
  } catch (error) {
    console.error('Error generating addresses:', error);
    res.status(500).json({ error: 'Failed to generate addresses' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT}/addresses to get blockchain addresses`);
});