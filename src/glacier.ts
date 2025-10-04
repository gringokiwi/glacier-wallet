import * as bitcoin from 'bitcoinjs-lib';
import { Transaction } from './mempool';
import type { BIP32Interface } from 'bip32';
import { Network, networkConfig } from './config';

export class GlacierHelper {
  private network: bitcoin.networks.Network;

  constructor(network: Network) {
    this.network = networkConfig[network].network;
  }

  createRedeemScript(
    lockHeight: number,
    pubKey: Uint8Array<ArrayBufferLike>,
  ): Uint8Array<ArrayBufferLike> {
    return bitcoin.script.compile([
      bitcoin.script.number.encode(lockHeight),
      bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY,
      bitcoin.opcodes.OP_DROP,
      bitcoin.opcodes.OP_DUP,
      bitcoin.opcodes.OP_HASH160,
      bitcoin.crypto.hash160(pubKey),
      bitcoin.opcodes.OP_EQUALVERIFY,
      bitcoin.opcodes.OP_CHECKSIG
    ]);
  }

  createOpReturnScript(lockHeight: number): Uint8Array<ArrayBufferLike> {
    const payment = bitcoin.payments.embed({
      data: [Buffer.from(`GLACIER ${lockHeight}`)]
    });
    if (!payment.output) throw new Error('Failed to create OP_RETURN output');
    return payment.output;
  }

  getLockAddress(
    redeemScript: Uint8Array<ArrayBufferLike>
  ): string {
    const p2sh = bitcoin.payments.p2sh({
      redeem: { output: redeemScript, network: this.network },
      network: this.network
    });
    if (!p2sh.address) throw new Error('Failed to create P2SH address');
    return p2sh.address;
  }

  createNewLockPsbt(
    lockHeight: number,
    parent: BIP32Interface,
  ): {
    psbt: bitcoin.Psbt,
    lockAddress: string
  } {
    const psbt = new bitcoin.Psbt({ network: this.network });
    const changeIndex = 3;
    const accountIndex = lockHeight;
    const child = parent.derive(changeIndex).derive(accountIndex);
    const redeemScript = this.createRedeemScript(lockHeight, child.publicKey);
    const lockAddress = this.getLockAddress(redeemScript);
    const opReturn = this.createOpReturnScript(lockHeight);
    psbt.addOutput({
      script: opReturn,
      value: 0n,
    });
    return {
      psbt,
      lockAddress,
    }
  }

  isLockTransaction(tx: Transaction): boolean {
    if (tx.vout.length !== 2) return false;
    const opReturn = tx.vout.find(v => v.scriptpubkey_type === 'op_return');
    if (!opReturn) return false;
    const chunks = opReturn.scriptpubkey_asm.split(' ');
    const hex = chunks.slice(-1)[0]?.toUpperCase();
    return hex?.startsWith('474C4143494552') || false;
  }

  parseLockTransaction(tx: Transaction, parent: BIP32Interface): ({
    lockHeight: number,
    lockAddress: string,
    redeemScript: Uint8Array<ArrayBufferLike>
  } | null) {
    const opReturnVout = tx.vout.find(v => v.scriptpubkey_type === 'op_return');
    if (!opReturnVout) {
      console.log(`No OP_RETURN output found in tx ${tx.txid}`);
      return null;
    }
    const chunks = opReturnVout.scriptpubkey_asm.split(' ');
    const hex = chunks.slice(-1)[0]?.toUpperCase();
    if (!hex?.startsWith('474C4143494552')) return null;
    const text = Buffer.from(hex, 'hex').toString('ascii');
    const match = text.match(/GLACIER (\d+)/);
    if (!match) {
      console.log(`Failed to parse lock height from tx ${tx.txid}`);
      return null;
    }
    const lockHeight = parseInt(match[1]);
    const lockAddress = tx.vout.find(vout => vout.scriptpubkey_type === 'p2sh')?.scriptpubkey_address;
    if (!lockAddress) {
      console.log(`No valid lock address found in tx ${tx.txid}`);
      return null;
    }
    const changeIndex = 3;
    const accountIndex = lockHeight;
    const child = parent.derive(changeIndex).derive(accountIndex);
    const redeemScript = this.createRedeemScript(lockHeight, child.publicKey);
    const expectedLockAddress = this.getLockAddress(redeemScript);
    if (lockAddress !== expectedLockAddress) {
      console.log(`Lock address mismatch in tx ${tx.txid}: expected ${expectedLockAddress}, got ${lockAddress}`);
      return null;
    }
    return {
      lockHeight,
      lockAddress,
      redeemScript
    }
  }
}