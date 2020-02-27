# Protocol Specification

## 004

The 004 protocol upgrade centers around a system that makes it easy and painless to upgrade to a future protocol version, as well as more modern cryptographic primitives.

_Note: this document largely documents only areas where procedures will have changed with respect to the previous version, 003. Some procedures, such as the auth\_params endpoint, are not documented below, but may be looked up in the respective version's specification document._

### Key Management

**There are three main concepts when it comes to keys:**

1. A root key
2. A root key wrapper
3. Items keys

- A root key is based on an account's user-inputted password. There exists only one root key per account.
- A root key wrapper _wraps_ a root key (encrypts it) with an additional layer. This is a local-only construct, and translates directly as an 'app passcode' feature.
- An items key is used to encrypt items. There can exist many items keys. Each items key is encrypted with the root key. When the root key changes, all items keys must be re-encrypted using the new root key.

#### Key Generation Flow

1. User registers with an email (`identifier`) and a `password`.
2. `password` is run through KDF to generate 512-bit key, which is then split in two, as part of a single `rootKey`.
   1. The first half is the `masterKey`.
   2. The second half is the `serverPassword`.
3. Client registers user account with server using `email` and `rootKey.serverPassword`.
4. Client creates new random 256-bit key `itemsKey`. This key is encrypted directly with `rootKey.masterKey`, and the encrypted `itemsKey` is assigned a UUID and uploaded to the user's account. (Each `itemsKey` is a traditional item, just like a note or tag.)

#### Encryption Flow

_For each_ item (such as a note) the client wants to encrypt:
1. Client generates random 256-bit `item_key` (note: singular. Not related to `itemsKey`). 
2. Client encrypts note content with `item_key`.
3. Client encrypts `item_key` with default `itemsKey` as `enc_item_key`.
4. Client notes `itemsKey` UUID and associates it with encrypted item payload as `items_key_id`, and uploads item to server.

To decrypt an item payload:
1. Client retrieves `itemsKey` matching `items_key_id` of item.
2. Client decrypts item's `enc_item_key` as `item_key` using `itemsKey`.
3. Client decrypts item's content using `item_key`.

#### Password change or protocol upgrade flow

**When a user changes their password, or when a new protocol version is available:**

1. Client generates new `rootKey` using account identifier and password, and thus generates new `rootKey.masterKey` and `rootKey.serverPassword` and `keyParams`, which include the protocol version and other public information used to guide clients on generating the `rootKey` given a user password.
2. Client submits new `rootKey.serverPassword` to server. Note that the changing the `serverPassword` does not necessarily invalidate a user's session. Sessions are handled through a separate server specification.
3. Client loops through all `itemsKeys` and re-encrypts them with new `rootKey.masterKey`. All `itemsKeys` are then re-uploaded to server. Note that `itemsKey`s are immutable and their inner key does not change. The key is only re-encrypted using the new `masterKey`.

This flow means that when a new protocol version is available or when a user changes their password, we do not need to re-encrypt all their data, but instead only a handful of keys.

#### Key Rotation

By default, upgrading an account's protocol version will create a new `itemsKey` for that version, and that key will be used to encrypt all data going forward. To prevent large-scale data modification that may take hours to complete, any data encrypted with a previous `itemsKey` will be re-encrypted with the new `itemsKey` _progressively_, and not all at once. This progressive re-encryption occurs when an item is explicitly modified by the user. Applications can also be designed to bulk-modify items during idle-capacity, without user interaction.

**When changing the account password:**

- If a new protocol version is available, changing the account password will also upgrade to the latest protocol version and thus generates a new default `itemsKey`.
- If no new protocol version is available, or if the user is already using the latest version, changing the account password generates a new `rootKey`, but does not generate a new `itemsKey`, unless the user explicitly chooses an option to "Rotate encryption keys". If the user chooses to rotate encryption keys, a new `itemsKey` will be generated and used as the default items encryption key, and will also be used to progressively re-encrypt previous data.

### Root Key Wrapping

Root key wrapping is a local-only construct that pertains to how the root key is stored locally. By default, and with no root key wrapping, the `rootKey` is stored in the secure device keychain. Only the `rootKey.masterKey` is stored locally; the `rootKey.serverPassword` is never stored locally, and is only used for initial account registration. If no keychain is available (web browsers), the `rootKey` is stored in storage in necessarily plain format.

Root key wrapping allows the client to encrypt the `rootKey` before storing it to disk. Wrapping a root key consists of:

1. Client asks user to choose a "local passcode".
2. The local passcode is run through the same key generation flow as account registration (using KDF) to generate a separate new root key known as the `rootKeyWrappingKey` (which likewise consists of a `masterKey` and an unused `serverPassword`).
3. The `rootKeyWrappingKey` is used to encrypt the `rootKey` as `wrappedRootKey`. The `wrappedRootKey` (along with `wrappingKeyKeyParams`) is stored directly in storage, and the keychain is cleared of previous unwrapped `rootKey`. (Some keychains have fixed payload size limit, so an encrypted payload may not always fit. For this reason `wrappedRootKey` is always stored directly in storage.)

**To unwrap a root key:**

1. Client displays an "Enter your local passcode" prompt to user.
2. Client runs user-inputted password through key generation scheme (using stored `wrappingKeyKeyParams`) to generate a temporary `rootKeyWrappingKey`.
3. Client attempts to decrypt `wrappedRootKey` using `rootKeyWrappingKey`. If the decryption process succeeds (no errors are thrown), the client successfully unlocks application, and keeps the unwrapped `rootKey` in application memory to aid in encryption and decryption of items (itemsKeys, to be exact).

**The purpose of root key wrapping is many-fold:**

1. To allow for secure storage of root key when no secure keychain is available (i.e web browsers).
2. Even in cases when a keychain is available, root key wrapping allows users to choose an arbitrary password to protect their storage with.
3. To allow for encryption of local storage.
4. To allow applications to introduce cryptographically-backed UI-level app locking.

When a root key is wrapped, no information about the wrapper is persisted locally or in memory beyond the `keyParams` for the wrapper. This includes any sort of hash for verification of the correctness of the entered local passcode. That is, when a user enters a local passcode, we know it is correct not because we compare one hash to another, but by whether it succeeds in decrypting some encrypted payload.

### Storage

**There exists three types of storage:**

1. **Value storage**: values such as user preferences, session token, and other app-specific values.
2. **Payload storage**: encrypted item payloads (such as notes and tags).
3. **Root key storage**: the primary root key.

How data is stored depends on different key scenarios.

#### Scenario A
_No root key and no root key wrapper (no account and no passcode)_
- **Value storage**: Plain, unencrypted
- **Payload storage**: Plain, unencrypted
- **Root key storage**: Not applicable

#### Scenario B 
_Root key but no root key wrapper (account but no passcode):_
- **Value storage**: Encrypted with root key
- **Payload storage:** Encrypted with root key
- **Root key storage**: 
    - With device keychain: Plainly in secure keychain
    - With no device keychain: Plainly in device storage

#### Scenario C
_Root key and root key wrapper (account and passcode):_
- **Value storage**: Encrypted with root key
- **Payload storage**: Encrypted with root key
- **Root key storage**: Encrypted in device storage

#### Scenario D
_No root key but root key wrapper (no account but passcode):_
- **Value storage**: Encrypted with root key wrapper
- **Payload storage**: Encrypted with root key wrapper
- **Root key storage**: Not applicable

### Cryptography Specifics

**Key Derivation:**

| Name               | Value    |
|--------------------|----------|
| Algorithm          | Argon2id |
| Memory (Bytes)     | 67108864 |
| Iterations         | 5        |
| Parallelism        | 1        |
| Salt Length (Bits) | 128      |
| Output Key (Bits)  | 512      |

**Encryption:**

| Name               | Value              |
|--------------------|--------------------|
| Algorithm          | XChaCha20+Poly1305 |
| Key Length (Bits)  | 256                |
| Nonce Length (Bits)| 192                |

#### Root Key Derivation Flow - Specifics

Given a user `identifier` (email) and `password` (user password):
1. Generate a random salt `seed`, 256 bits (`hex`).
2. Generate `salt`:
   1. `hash = SHA256Hex('identifier:seed')`
   2. `salt = hash.substring(0, 32)`
3. Generate `derivedKey = argon2(password, salt, ITERATIONS, MEMORY, OUTPUT_LENGTH) `
4. Generate `rootKey = {masterKey: derivedKey.firstHalf, serverPassword: derivedKey.secondHalf, version: '004'}`
5. For account registration, `seed`, `serverPassword`, and `version` must be uploaded to the server.

**Understanding the salt `seed`:**

Our threat model is intended to distrust the server as much as possible. For this reason, we do not want to blindly trust whatever salt value a server returns to us. For example, a malicious server may attempt to mass-weaken user security by sending the same salt for every user account, and observe what interesting results the clients send back. Instead,  clients play a more significant role in salt generation, and use the value the user inputs into the email field for salt generation.

At this point we have `salt = generateSalt(email)`. However, we'd ideally like to make this value more unique. Emails are globally unique, but well-known in advance. We could introduce more variability by also including the protocol version in salt computation, such as `salt = generateSalt(email, version)`, but this could also be well-accounted for in advance.

The salt `seed` serves as a way to make it truly impossible to know a salt for an account ahead of time, without first interacting with the server the account is hosted on. While retrieving a `seed` for a given account is a public, non-authorized operation, users who configure two-factor authentication can proceed to lock this operation so that a proper 2FA code is required to retrieve the salt `seed`. Salts are thus computed via `salt = generateSalt(email, seed)`.

#### Items Key Generation Flow
1. Generate random `hex` string `key`, 256 bits.
2. Create `itemsKey = {itemsKey: key, version: '004'}`

#### Encryption - Specifics

An encrypted payload consists of:
- `items_key_id`: The UUID of the `itemsKey` used to encrypt `enc_item_key`.
- `enc_item_key`: An encrypted protocol string joined by colons `:` of the following components:
  - protocol version
  - encryption nonce
  - ciphertext
- `content`: An encrypted protocol string joined by colons `:` of the following components:
  - protocol version
  - encryption nonce
  - ciphertext

**Procedure to encrypt an item (such as a note):**

1. Generate a random 256-bit key `item_key` (in `hex` format).
2. Encrypt `item.content` as `content` using `item_key` following the instructions _"Encrypting a string using the 004 scheme"_ below.
3. Encrypt `item_key` as `enc_item_key` using the the default `itemsKey.itemsKey` following the instructions _"Encrypting a string using the 004 scheme"_ below.
4. Generate an encrypted payload as:
    ```
    {
        items_key_id: itemsKey.uuid,
        enc_item_key: enc_item_key,
        content: content
    }
    ```

### Encrypting a string using the 004 scheme:

Given a `string_to_encrypt`, an `encryption_key`, and an item's `uuid`:

1.  Generate a random 192-bit string called `nonce`.
2.  Generate additional authenticated data as `aad = JSON.stringify({ u: uuid, v: '004' })`
3.  Encrypt `string_to_encrypt` using `XChaCha20+Poly1305:Base64`, `encryption_key`, `nonce`, and `aad`:
  ```
  ciphertext = XChaCha20Poly1305(string_to_encrypt, encryption_key, nonce, aad)
  ```
4.  Generate the final result by combining components into a `:` separated string:
  ```
  result = ['004', nonce, ciphertext].join(':')
  ```