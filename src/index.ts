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
  const addresses = new Map<string, Address>();
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
        addresses.set(address, data);
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
      addresses.set(address, data);
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
    addresses.set(lockAddress, data);

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
    const sweepAddress = Array.from(addresses.values()).find(data => !data.used)?.address;
    if (!sweepAddress) throw new Error('No unused address available for sweeping GLACIER locks');
    const totalToSweep = unlockValue - 1000n;
    unlockPsbt.addOutput({
      address: sweepAddress,
      value: totalToSweep
    });
    unlockPsbtHex = unlockPsbt.toHex();
  }

  return {
    addresses: Array.from(addresses.values()),
    newLockPsbt: newLockPsbtHex,
    unlockPsbt: unlockPsbtHex,
    unlockIndices: unlockIndices.length ? unlockIndices : undefined
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

// Helper function to generate QR code URLs
const generateQRCodeUrl = (address: string, size: number = 200): string => {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${address}`;
};

// Helper function to generate HTML for addresses
const generateAddressHTML = (address: Address): string => {
  const qrCodeUrl = generateQRCodeUrl(address.address);
  const explorerUrl = NETWORK === 'testnet4' ?
    `https://mempool.space/testnet4/address/${address.address}` :
    `https://mempool.space/address/${address.address}`;
  const statusClass = address.spendable ? 'spendable' : 'locked';
  const hiddenClass = address.used && address.spendable ? 'hidden' : '';
  const statusText = address.spendable ? 'Spendable' : 'Locked';
  const balanceText = address.balance > 0 ? `${address.balance} sats` : '0 sats';
  const unlockTxLink = address.unlock_tx ?
    `<p><a href="${address.unlock_tx}" target="_blank">Unlock Transaction</a></p>` : '';

  return `
    <div class="address-card ${hiddenClass}">
      <h3>${address.label}</h3>
      <p class="address-path">${address.path}</p>
      <img src="${qrCodeUrl}" alt="QR Code for ${address.address}" class="qr-code">
      <p class="address-text">${address.address}</p>
      <div class="address-details">
        <span class="balance">Balance: ${balanceText}</span>
        <span class="status ${statusClass}">${statusText}</span>
      </div>
      ${unlockTxLink}
      <p><a href="${explorerUrl}" target="_blank">View on Explorer</a></p>
    </div>
  `;
};

// Helper function to generate HTML response
const generateHTMLResponse = (xpub: string, addresses: Address[], newLockPsbt?: string): string => {
  const addressCards = addresses.map(address => generateAddressHTML(address)).join('');
  const psbtSection = newLockPsbt ?
    `<div class="psbt-section">
      <h2>Lock Transaction PSBT</h2>
      <textarea rows="5" style="width: 100%;">${newLockPsbt}</textarea>
    </div>` : '';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title🧊 Glacier Wallet</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          margin: 0;
          padding: 20px;
          background-color: #bff3ffff;
        }
        .container {
          max-width: 1200px;
          margin: 0 auto;
          text-align: center;
        }
        h1 {
          color: #333;
          background-color: #e0f7fa;
          border-radius: 8px;
          display: inline-block;
          padding: 10px 20px;
        }
        .xpub {
          background-color: #fff;
          padding: 15px;
          border-radius: 5px;
          margin: 20px 0;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .address-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 20px;
          margin: 20px 0;
        }
        .address-card {
          background-color: #fff;
          padding: 15px;
          border-radius: 5px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .hidden {
          opacity: 0.5;
        }
        .address-card h3 {
          margin: 0 0 10px;
          color: #333;
        }
        .address-path {
          font-size: 0.9em;
          color: #666;
          margin: 0 0 15px;
        }
        .qr-code {
          display: block;
          margin: 0 auto 15px;
          width: 200px;
          height: 200px;
        }
        .address-text {
          font-family: monospace;
          font-size: 1em;
          word-break: break-all;
          margin: 10px 0;
          padding: 8px;
          background-color: #f8f8f8;
          border: 1px solid #ddd;
          border-radius: 4px;
        }
        .address-details {
          display: flex;
          justify-content: space-between;
          margin: 15px 0;
        }
        .balance {
          font-weight: bold;
          color: #333;
        }
        .status {
          padding: 3px 8px;
          border-radius: 4px;
          font-size: 0.8em;
          font-weight: bold;
          text-transform: uppercase;
        }
        .spendable {
          background-color: #d4edda;
          color: #155724;
        }
        .locked {
          background-color: #f8d7da;
          color: #721c24;
        }
        .psbt-section {
          margin: 20px 0;
          background-color: #fff;
          padding: 15px;
          border-radius: 5px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .psbt-section textarea {
          margin-top: 10px;
          font-family: monospace;
          padding: 10px;
          border: 1px solid #ddd;
          border-radius: 4px;
        }
        .error {
          color: #721c24;
          background-color: #f8d7da;
          padding: 15px;
          border-radius: 5px;
          margin: 20px 0;
        }
        @media (max-width: 768px) {
          .address-grid {
            grid-template-columns: 1fr;
          }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🧊 Glacier Wallet</h1>
        <div class="xpub">
          <p>Extended Public Key (xpub): <code>${xpub}</code></p>
        </div>
        ${addressCards ? `<div class="address-grid">${addressCards}</div>` : ''}
        ${psbtSection}
      </div>
    </body>
    </html>
  `;
};

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
      });
    }

    // Generate HTML with QR codes
    const html = generateHTMLResponse(xpub, addresses, newLockPsbt);
    res.send(html);
  } catch (error) {
    console.error('Error generating addresses:', error);
    res.status(500).send(`
      <html>
        <body>
          <div class="error">
            <h2>Error</h2>
            <p>Failed to generate addresses: ${error}</p>
          </div>
        </body>
      </html>
    `);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT}/addresses to get blockchain addresses`);
});