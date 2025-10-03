import express from 'express';
import * as bip39 from 'bip39';
import * as bitcoin from 'bitcoinjs-lib';
import * as bip32 from 'bip32';
import * as ecc from 'tiny-secp256k1';
import type { Request, Response } from 'express';
import axios from 'axios';

const bip32Instance = bip32.BIP32Factory(ecc);

const networksConfig = {
  mainnet: {
    network: bitcoin.networks.bitcoin,
    path: "m/84'/0'/0'/0"
  },
  testnet4: {
    network: bitcoin.networks.testnet,
    path: "m/84'/1'/0'/0"
  }
};
type Network = keyof typeof networksConfig;

const MNEMONIC_PHRASE = "work inherit world enforce feel artwork casino duty denial sea robust vivid";
const NETWORK: Network = "testnet4";

type Address = {
  network: Network;
  address: string;
  path: string;
  index: number;
  used: boolean;
  balance: number;
}

type GlacierLock = {
  network: Network;
  address: string;
  lock_height: number;
  spendable: boolean;
  balance: number;
  sweep_tx?: string;
}

const getAddresses = async (xpub: string, count: number): Promise<{ addresses: Array<Address>, glacierLocks: Array<GlacierLock>, newGlacierLock?: GlacierLock }> => {
  const parent = bip32Instance.fromBase58(xpub);
  const config = networksConfig[NETWORK];

  const addresses = new Set<Address>();
  const glacierLocks = new Set<GlacierLock>();

  // Fetch current block height to determine if locks are spendable
  const currentHeight = await axios.get(`https://mempool.space/testnet4/api/blocks/tip/height`).then(res => res.data);

  let lastAddress: Address | undefined;

  const transactions = new Set<{
    txid: string,
    vout: Array<{
      scriptpubkey_asm: string,
      scriptpubkey_type: "op_return",
      scriptpubkey_address: undefined,
      value: 0
    } | {
      scriptpubkey_asm: string,
      scriptpubkey_type: string,
      scriptpubkey_address: string,
      value: number
    }>
  }>();

  const newLockPsbt = new bitcoin.Psbt({ network: config.network });
  const newLockHeight = currentHeight + 6; // Example: lock for 6 blocks in the future
  const newLockRedeemScript = bitcoin.script.compile([
    bitcoin.script.number.encode(newLockHeight),     // Encoded block height
    bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY,              // CLTV (177)
    bitcoin.opcodes.OP_DROP,                             // Drop locktime from stack
    bitcoin.opcodes.OP_DUP,                              // Duplicate pubkey
    bitcoin.opcodes.OP_HASH160,                          // Hash public key
    bitcoin.crypto.hash160(parent.publicKey),            // Push pubkey hash
    bitcoin.opcodes.OP_EQUALVERIFY,                      // Verify hash matches
    bitcoin.opcodes.OP_CHECKSIG                          // Validate signature
  ]);
  const newLockP2sh = bitcoin.payments.p2sh({
    redeem: { output: newLockRedeemScript, network: config.network },
    network: config.network
  });
  const newLockAddress = newLockP2sh.address!;
  const newLockOpReturnScript = bitcoin.payments.embed({ data: [Buffer.from(`GLACIER ${newLockHeight}`)] }).output!;

  for (let i = 0; i < count; i++) {
    if (!lastAddress || (lastAddress && lastAddress.used)) {
      try {
        const child = parent.derive(i);

        const p2wpkh = bitcoin.payments.p2wpkh({
          pubkey: child.publicKey,
          network: config.network
        });

        if (!p2wpkh.address) continue;
        const address = p2wpkh.address;

        let data: Address = {
          network: NETWORK,
          address,
          path: `${config.path}/${i}`,
          index: i,
          used: false,
          balance: 0
        };

        const summary = await axios.get<{
          chain_stats: {
            tx_count: number,
            funded_txo_sum: number,
            spent_txo_sum: number
          },
          mempool_stats: {
            tx_count: number,
            funded_txo_sum: number,
            spent_txo_sum: number
          }
        }>(`https://mempool.space/testnet4/api/address/${address}`).then(res => res.data);

        data.used = (summary.chain_stats.tx_count + summary.mempool_stats.tx_count) > 0;

        if (!data.used) {
          lastAddress = data;
          addresses.add(data);
          continue;
        }

        data.balance = (summary.chain_stats.funded_txo_sum + summary.mempool_stats.funded_txo_sum) - (summary.chain_stats.spent_txo_sum + summary.mempool_stats.spent_txo_sum);

        if (data.balance) {
          const utxos = await axios.get<Array<{
            txid: string;
            vout: number;
            value: number;
          }>>(`https://mempool.space/testnet4/api/address/${address}/utxo`).then(res => res.data);
          for (const utxo of utxos) {
            newLockPsbt.addInput({
              hash: utxo.txid,
              index: utxo.vout,
              witnessUtxo: {
                script: p2wpkh.output!,
                value: BigInt(utxo.value)
              }
            });
          }
        }

        const addressTransactions = await axios.get<Array<{
          txid: string,
          vout: Array<{
            scriptpubkey_asm: string,
            scriptpubkey_type: "op_return",
            scriptpubkey_address: undefined,
            value: 0
          } | {
            scriptpubkey_asm: string,
            scriptpubkey_type: string,
            scriptpubkey_address: string,
            value: number
          }>
        }>>(`https://mempool.space/testnet4/api/address/${address}/txs`).then(res => res.data);

        for (const tx of addressTransactions) {
          if (!tx.vout.some(vout => vout.scriptpubkey_type === 'op_return')) {
            continue;
          }
          if (tx.vout.length !== 2) {
            continue;
          }
          const opReturnVout = tx.vout.find(vout => vout.scriptpubkey_type === 'op_return')!;
          const chunks = opReturnVout.scriptpubkey_asm.split(' ');
          const hex = chunks.slice(-1)[0].toUpperCase();
          if (!hex.startsWith('474C4143494552')) { // "GLACIER" in hex
            console.log(`Unrecognized OP_RETURN prefix in tx ${tx.txid}: ${hex}`);
            continue;
          }
          transactions.add(tx);
        }

        lastAddress = data;
        addresses.add(data);
      } catch (error) {
        console.error(`Error generating address for ${NETWORK} at index ${i}:`, error);
      }
    }
  }

  for (const tx of transactions) {
    const opReturnVout = tx.vout.find(vout => vout.scriptpubkey_type === 'op_return');
    if (!opReturnVout) {
      continue;
    }
    const chunks = opReturnVout.scriptpubkey_asm.split(' ');
    const hex = chunks.slice(-1)[0].toUpperCase();
    if (!hex.startsWith('474C4143494552')) { // "GLACIER" in hex
      console.log(`Unrecognized OP_RETURN prefix in tx ${tx.txid}: ${hex}`);
      continue;
    }
    const text = Buffer.from(hex, 'hex').toString('ascii');
    const lockHeight = parseInt(text);
    const lockAddress = tx.vout.find(vout => vout.scriptpubkey_type === 'p2sh')?.scriptpubkey_address;
    if (!lockAddress) {
      console.log(`No valid lock address found in tx ${tx.txid}`);
      continue;
    }
    const lockSummary = await axios.get<{
      chain_stats: {
        tx_count: number,
        funded_txo_sum: number,
        spent_txo_sum: number
      },
      mempool_stats: {
        tx_count: number,
        funded_txo_sum: number,
        spent_txo_sum: number
      }
    }>(`https://mempool.space/testnet4/api/address/${lockAddress}`).then(res => res.data);
    const lockBalance = (lockSummary.chain_stats.funded_txo_sum + lockSummary.mempool_stats.funded_txo_sum) - (lockSummary.chain_stats.spent_txo_sum + lockSummary.mempool_stats.spent_txo_sum);
    if (lockBalance === 0) {
      console.log(`Skipping GLACIER lock at ${lockAddress} with zero balance in tx ${tx.txid}`);
      continue;
    }
    const redeemScript = bitcoin.script.compile([
      bitcoin.script.number.encode(lockHeight),            // Encoded block height
      bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY,              // CLTV (177)
      bitcoin.opcodes.OP_DROP,                             // Drop locktime from stack
      bitcoin.opcodes.OP_DUP,                              // Duplicate pubkey
      bitcoin.opcodes.OP_HASH160,                          // Hash public key
      bitcoin.crypto.hash160(parent.publicKey),            // Push pubkey hash
      bitcoin.opcodes.OP_EQUALVERIFY,                      // Verify hash matches
      bitcoin.opcodes.OP_CHECKSIG                          // Validate signature
    ]);
    const p2sh = bitcoin.payments.p2sh({
      redeem: { output: redeemScript, network: config.network },
      network: config.network
    });
    if (p2sh.address !== lockAddress) {
      console.log(`Address mismatch for GLACIER ${lockHeight} in tx ${tx.txid}: expected ${lockAddress}, got ${p2sh.address}`);
      continue;
    }
    const lockData: GlacierLock = {
      network: NETWORK,
      address: lockAddress,
      lock_height: lockHeight,
      spendable: currentHeight >= lockHeight,
      balance: lockBalance
    };
    if (lockBalance && currentHeight >= lockHeight) {
      const sweepAddress = Array.from(addresses).find(addr => !addr.used)?.address;
      if (!sweepAddress) {
        console.log(`No unused address available to sweep GLACIER ${lockHeight} at ${lockAddress}`);
        continue;
      }
      const psbt = new bitcoin.Psbt({ network: config.network });
      let totalInput = 0n;
      const utxos = await axios.get<Array<{
        txid: string;
        vout: number;
        value: number;
      }>>(`https://mempool.space/testnet4/api/address/${lockAddress}/utxo`).then(res => res.data);
      for (const utxo of utxos) {
        const txHex = await axios.get<string>(`https://mempool.space/testnet4/api/tx/${utxo.txid}/hex`).then(res => res.data);
        psbt.addInput({
          hash: utxo.txid,
          index: utxo.vout,
          sequence: 0,
          nonWitnessUtxo: bitcoin.Transaction.fromHex(txHex).toBuffer(),
          redeemScript
        });
        totalInput += BigInt(utxo.value);
      }
      psbt.setLocktime(lockHeight);
      psbt.addOutput({
        address: sweepAddress,
        value: totalInput - 1000n // subtract 1000 sat fee
      });
      lockData.sweep_tx = psbt.toHex();
    }
    glacierLocks.add(lockData);
  }

  let newGlacierLock: GlacierLock | undefined;

  if (newLockPsbt.inputCount > 0) {
    const totalToLock = newLockPsbt.data.inputs.reduce((sum, input) => sum + input.witnessUtxo!.value, 0n) - 1000n;
    newLockPsbt.addOutput({
      address: newLockAddress,
      value: totalToLock
    });
    newLockPsbt.addOutput({
      script: newLockOpReturnScript,
      value: 0n
    });
    newGlacierLock = {
      network: NETWORK,
      address: newLockAddress,
      lock_height: newLockHeight,
      spendable: false,
      balance: Number(totalToLock),
      sweep_tx: newLockPsbt.toHex()
    };
  }

  return {
    addresses: Array.from(addresses),
    glacierLocks: Array.from(glacierLocks),
    newGlacierLock
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/addresses', async (req: Request, res: Response) => {
  const seed = bip39.mnemonicToSeedSync(MNEMONIC_PHRASE);
  const root = bip32Instance.fromSeed(seed);
  const config = networksConfig[NETWORK];
  const parent = root.derivePath(config.path);
  const xpub = parent.neutered().toBase58();

  try {
    const count = parseInt(req.query.count as string) || 10;
    const { addresses, glacierLocks, newGlacierLock } = await getAddresses(xpub, count);
    const signedGlacierUnlocks = new Set<string>();

    for (const lock of glacierLocks) {
      if (lock.sweep_tx) {
        console.log(`GLACIER Lock at height ${lock.lock_height} is spendable. Signing sweep transaction...`);
        const psbt = bitcoin.Psbt.fromHex(lock.sweep_tx!, { network: config.network });
        for (const [index, input] of psbt.data.inputs.entries()) {
          psbt.signInput(index, parent);
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
        signedGlacierUnlocks.add(tx.toHex());
      }
    }

    res.send(`<html><pre>${JSON.stringify({
      xpub,
      addresses,
      glacierLocks,
      signedGlacierUnlocks: Array.from(signedGlacierUnlocks),
      newGlacierLock
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