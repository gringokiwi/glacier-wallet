
<img width="1278" height="729" alt="Screenshot 2025-10-03 at 1 10 57 PM" src="https://github.com/user-attachments/assets/37c012c9-755a-4e05-bba2-1b9dbdb2c5cf" />

# Glacier Wallet

Bitcoin supports the ability to 'timelock' your ability to spend coins until some point in the future. Unfortunately, it is quite hard to set up with existing software. Glacier Wallet makes it simple.

## Demo

### Request addresses for a fresh BIP39 seed

Like most wallet, Glacier will derive a keypair from your seed phrase, and loop through your native Segwit addresses using standard derivation paths until it finds an unused address.

```json
{
  "xpub": "xpub6CXDiESz32DzFqhUkbPRDGMJqVeXkayxprMa3esG7WPFVM9WcPZp1eAxpREYMU7ZfFcY64TKHZr5yUrp1WLCehQecPNi8h3SE1xhpG5XLnD",
  "addresses": [
    {
      "label": "Receive Address #0 (New)",
      "network": "testnet4",
      "address": "tb1qzrtmctvzju33mqtf6tdmpq0n7w7hk4jcyjnasp",
      "path": "m/84'/1'/0'/0/0",
      "index": 0,
      "used": false,
      "balance": 0,
      "spendable": true
    }
  ]
}
```

### Fund wallet

After funding your wallet, a new Glacier lock will be generated (custom time), with a PSBT sweeping funds to a P2SH CTLV address. An OP_RETURN is also created with the text `GLACIER <UNLOCK_BLOCK_HEIGHT>`

Demo funding tx: https://mempool.space/testnet4/tx/5d38022e14fc99e21f80844c24f094eb48cde5ccee120955abbfcf1ecb543f25

```json
{
  "xpub": "xpub6CXDiESz32DzFqhUkbPRDGMJqVeXkayxprMa3esG7WPFVM9WcPZp1eAxpREYMU7ZfFcY64TKHZr5yUrp1WLCehQecPNi8h3SE1xhpG5XLnD",
  "addresses": [
    {
      "label": "Receive Address #0 (Used)",
      "network": "testnet4",
      "address": "tb1qzrtmctvzju33mqtf6tdmpq0n7w7hk4jcyjnasp",
      "path": "m/84'/1'/0'/0/0",
      "index": 0,
      "used": true,
      "balance": 50000,
      "spendable": true
    },
    {
      "label": "Receive Address #1 (New)",
      "network": "testnet4",
      "address": "tb1q0zc4c86ucvw24qqwt59sch58mmw2gsv5k69mcy",
      "path": "m/84'/1'/0'/0/1",
      "index": 1,
      "used": false,
      "balance": 0,
      "spendable": true
    }
  ],
  "newLockPsbt": "70736274ff01006c0200000001253f54cb1ecfbfab550912eecce5cd48eb94f0244c84801fe299fc142e02385d0100000000ffffffff020000000000000000106a0e474c41434945522031303439383668bf00000000000017a91428d33c9c4697d495960f7a35e8c2e61a109b268387000000000001011f50c300000000000016001410d7bc2d8297231d8169d2dbb081f3f3bd7b5658000000"
}
```

### Create Glacier lock

The lock tx from above can be signed from a wallet using the same seed phrase:

<img width="926" height="673" alt="Screenshot 2025-10-04 at 1 31 00 PM" src="https://github.com/user-attachments/assets/3caae025-a07e-49cb-a872-20bada3d9207" />

Demo tx (current height + 2 blocks): https://mempool.space/testnet4/tx/fb077b0439d52225c634fa7a62a3bf9c2ccd8df41d41a3b3028793313aa8216e

<img width="1138" height="226" alt="Screenshot 2025-10-04 at 1 31 24 PM" src="https://github.com/user-attachments/assets/fb2c4388-7aed-4921-aaaf-7b8de5f29351" />

### Refresh addresses

The Glacier lock is detected via the OP_RETURN created in the lock transaction:


```json
{
  "xpub": "xpub6CXDiESz32DzFqhUkbPRDGMJqVeXkayxprMa3esG7WPFVM9WcPZp1eAxpREYMU7ZfFcY64TKHZr5yUrp1WLCehQecPNi8h3SE1xhpG5XLnD",
  "addresses": [
    {
      "label": "Receive Address #0 (Used)",
      "network": "testnet4",
      "address": "tb1qzrtmctvzju33mqtf6tdmpq0n7w7hk4jcyjnasp",
      "path": "m/84'/1'/0'/0/0",
      "index": 0,
      "used": true,
      "balance": 0,
      "spendable": true
    },
    {
      "label": "Receive Address #1 (New)",
      "network": "testnet4",
      "address": "tb1q0zc4c86ucvw24qqwt59sch58mmw2gsv5k69mcy",
      "path": "m/84'/1'/0'/0/1",
      "index": 1,
      "used": false,
      "balance": 0,
      "spendable": true
    },
    {
      "label": "Glacier Lock (104986) - Active",
      "network": "testnet4",
      "address": "2Mvy64wjehVsq81i3fCep5ZqpUTYKaVcoKE",
      "path": "m/84'/1'/0'/3/104986",
      "index": 104986,
      "used": true,
      "balance": 49000,
      "spendable": false
    }
  ]
}
```

### Add more funds

More funds can be added to the lock at any time, e.g.: https://mempool.space/testnet4/tx/ae49f4a6c811a15df5f83e51c7ab1065b334a1ec67adbed07447463d402ce99b

This is reflected upon refresh:

```json
{
  "xpub": "xpub6CXDiESz32DzFqhUkbPRDGMJqVeXkayxprMa3esG7WPFVM9WcPZp1eAxpREYMU7ZfFcY64TKHZr5yUrp1WLCehQecPNi8h3SE1xhpG5XLnD",
  "addresses": [
    {
      "label": "Receive Address #0 (Used)",
      "network": "testnet4",
      "address": "tb1qzrtmctvzju33mqtf6tdmpq0n7w7hk4jcyjnasp",
      "path": "m/84'/1'/0'/0/0",
      "index": 0,
      "used": true,
      "balance": 0,
      "spendable": true
    },
    {
      "label": "Receive Address #1 (New)",
      "network": "testnet4",
      "address": "tb1q0zc4c86ucvw24qqwt59sch58mmw2gsv5k69mcy",
      "path": "m/84'/1'/0'/0/1",
      "index": 1,
      "used": false,
      "balance": 0,
      "spendable": true
    },
    {
      "label": "Glacier Lock (104986) - Active",
      "network": "testnet4",
      "address": "2Mvy64wjehVsq81i3fCep5ZqpUTYKaVcoKE",
      "path": "m/84'/1'/0'/3/104986",
      "index": 104986,
      "used": true,
      "balance": 74000,
      "spendable": false
    }
  ]
}
```

## Unlock Glacier lock

Once the Glacier lock has expired, a PSBT will be generated for the unlock, sweeping all funds to your next unused address:

```json
{
  "xpub": "xpub6CXDiESz32DzFqhUkbPRDGMJqVeXkayxprMa3esG7WPFVM9WcPZp1eAxpREYMU7ZfFcY64TKHZr5yUrp1WLCehQecPNi8h3SE1xhpG5XLnD",
  "addresses": [
    {
      "label": "Receive Address #0 (Used)",
      "network": "testnet4",
      "address": "tb1qzrtmctvzju33mqtf6tdmpq0n7w7hk4jcyjnasp",
      "path": "m/84'/1'/0'/0/0",
      "index": 0,
      "used": true,
      "balance": 0,
      "spendable": true
    },
    {
      "label": "Receive Address #1 (Used)",
      "network": "testnet4",
      "address": "tb1q0zc4c86ucvw24qqwt59sch58mmw2gsv5k69mcy",
      "path": "m/84'/1'/0'/0/1",
      "index": 1,
      "used": true,
      "balance": 73000,
      "spendable": true
    },
    {
      "label": "Receive Address #2 (New)",
      "network": "testnet4",
      "address": "tb1q6l6rtq9af6de46nat0d649jn9wm8s9ucqer7n2",
      "path": "m/84'/1'/0'/0/2",
      "index": 2,
      "used": false,
      "balance": 0,
      "spendable": true
    },
    {
      "label": "Glacier Lock (104986) - Expired",
      "network": "testnet4",
      "address": "2Mvy64wjehVsq81i3fCep5ZqpUTYKaVcoKE",
      "path": "m/84'/1'/0'/3/104986",
      "index": 104986,
      "used": true,
      "balance": 0,
      "spendable": true,
      "unlock_tx": "https://mempool.space/testnet4/tx/ee616da10399ed706d70cd87d4ef2cba6585772e5fccb4efb2b755af5f0a3797"
    }
  ],
  "newLockPsbt": "70736274ff01006c020000000197370a5faf55b7b2efb4cc5f2e778565ba2cefd487cd706d70ed9903a16d61ee0000000000ffffffff020000000000000000106a0e474c414349455220313034393933401901000000000017a914b494c86bbc9e712df75b7bc161183d7f453c452087000000000001011f281d01000000000016001478b15c1f5cc31caa800e5d0b0c5e87dedca44194000000"
}
```

<img width="1146" height="225" alt="Screenshot 2025-10-04 at 1 46 48 PM" src="https://github.com/user-attachments/assets/4db908f3-9d50-4b01-8141-ef7a4eb53b46" />

## Recovery

If you mistakenly send more funds to the same Glacier lock, you can sweep them anytime, e.g. https://mempool.space/testnet4/tx/9366a86f672a437d5e94d28bce9abd79dddc68bfdbaa7528eaf0265d7669e2d8

## Electrum Plugin

[@Ampersand](https://github.com/Amperstrand/) has developed an Electrum plugin, one-shotted with an LLM ([context](https://gist.github.com/Amperstrand/401c397fc7ba579779eb14f25b5bd86d))

![photo_2025-10-03_13-18-52](https://github.com/user-attachments/assets/9f8d4310-d63a-4392-aa34-48bdad640bcd)

