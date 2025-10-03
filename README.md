
<img width="1278" height="729" alt="Screenshot 2025-10-03 at 1 10 57 PM" src="https://github.com/user-attachments/assets/37c012c9-755a-4e05-bba2-1b9dbdb2c5cf" />

# Glacier Wallet

Bitcoin supports the ability to 'timelock' your ability to spend coins until some point in the future. Unfortunately, it is quite hard to set up with existing software. Glacier Wallet makes it simple.

## Demo

### Request addresses for a fresh BIP39 seed

```json
{
  "xpub": "xpub6EChyDXBPAwVg4HGwLJzGGZDm8P5LeCrk2v2AS7NkaW2i1PLNWtHmnwafVVjzM3L9n8xHohj3kcDM5VrMvJZ4YXF651voKhVBmbD9tGE77b",
  "addresses": [
    {
      "network": "testnet4",
      "address": "tb1qy5r8sapl0zfpyq4tnns8y9daqejy2ah32kckjk",
      "path": "m/84'/1'/0'/0/0",
      "index": 0,
      "used": false,
      "balance": 0
    }
  ],
  "glacierLocks": [],
  "signedGlacierUnlocks": []
}
```

### Fund address

Address funding tx: https://mempool.space/testnet4/tx/d5f0c7bd13fe3ce8720cd5d1b02625eba5970ced4d4099ec9ea6dd209287209a

```json
{
  "xpub": "xpub6EChyDXBPAwVg4HGwLJzGGZDm8P5LeCrk2v2AS7NkaW2i1PLNWtHmnwafVVjzM3L9n8xHohj3kcDM5VrMvJZ4YXF651voKhVBmbD9tGE77b",
  "addresses": [
    {
      "network": "testnet4",
      "address": "tb1qy5r8sapl0zfpyq4tnns8y9daqejy2ah32kckjk",
      "path": "m/84'/1'/0'/0/0",
      "index": 0,
      "used": true,
      "balance": 500000
    },
    {
      "network": "testnet4",
      "address": "tb1q6rufkmhshd585vn5sns7x2qeryxzqav6nap9g6",
      "path": "m/84'/1'/0'/0/1",
      "index": 1,
      "used": false,
      "balance": 0
    }
  ],
  "glacierLocks": [],
  "signedGlacierUnlocks": [],
  "newGlacierLock": {
    "network": "testnet4",
    "address": "2N9ryWMiekbqCp6rmGphgmybRdyPwSY93Pv",
    "lock_height": 104852,
    "spendable": false,
    "balance": 499000,
    "sweep_tx": "70736274ff01006c02000000019a20879220dda69eec99404ded0c97a5eb2526b0d1d50c72e83cfe13bdc7f0d50000000000ffffffff02389d07000000000017a914b644e60ccde5f7118b2bfbb6e41527a529317601870000000000000000106a0e474c414349455220313034383532000000000001011f20a1070000000000160014250678743f78921202ab9ce07215bd06644576f1000000"
  }
}
```

### Create Glacier lock

Sign & broadcast the sweep tx from above:

<img width="926" height="699" alt="Screenshot 2025-10-03 at 1 18 12 PM" src="https://github.com/user-attachments/assets/7f65128c-842d-4195-b79a-01e30c44f9e1" />

Lock tx (current height + 6 blocks): https://mempool.space/testnet4/tx/8bafba99843e253336993fc1849e043b0ddb6b6fdb6a8f1ccc6c726ad1881748

#### Re-fetch addresses

The Glacier lock is detected by the OP_RETURN created in the lock transaction:

<img width="1150" height="233" alt="Screenshot 2025-10-03 at 1 21 32 PM" src="https://github.com/user-attachments/assets/184ccf6c-c141-4ae6-813e-df24f39d9fc6" />


```json
{
  "xpub": "xpub6EChyDXBPAwVg4HGwLJzGGZDm8P5LeCrk2v2AS7NkaW2i1PLNWtHmnwafVVjzM3L9n8xHohj3kcDM5VrMvJZ4YXF651voKhVBmbD9tGE77b",
  "addresses": [
    {
      "network": "testnet4",
      "address": "tb1qy5r8sapl0zfpyq4tnns8y9daqejy2ah32kckjk",
      "path": "m/84'/1'/0'/0/0",
      "index": 0,
      "used": true,
      "balance": 0
    },
    {
      "network": "testnet4",
      "address": "tb1q6rufkmhshd585vn5sns7x2qeryxzqav6nap9g6",
      "path": "m/84'/1'/0'/0/1",
      "index": 1,
      "used": false,
      "balance": 0
    }
  ],
  "glacierLocks": [
    {
      "network": "testnet4",
      "address": "2N9ryWMiekbqCp6rmGphgmybRdyPwSY93Pv",
      "lock_height": 104852,
      "spendable": false,
      "balance": 499000
    }
  ],
  "signedGlacierUnlocks": []
}
```

## Add more funds

More funds can be added at any time:


## Unlock Glacier lock

Pending...

## Electrum Plugin

[@Ampersand](https://github.com/Amperstrand/) has developed an Electrum plugin, one-shotted with an LLM ([context](https://gist.github.com/Amperstrand/401c397fc7ba579779eb14f25b5bd86d))

![photo_2025-10-03_13-18-52](https://github.com/user-attachments/assets/9f8d4310-d63a-4392-aa34-48bdad640bcd)

