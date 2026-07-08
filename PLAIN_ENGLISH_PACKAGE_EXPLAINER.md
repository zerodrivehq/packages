# ZeroDrive packages explained in plain English

This document explains why ZeroDrive now has an organization, why there is a separate package repository, what “capsule” means, what “recovery” means, and how all of this helps normal users.

It avoids assuming deep software knowledge. The goal is to make the direction clear to anyone joining the project, even if they do not work on encryption or backend systems every day.

## The simple idea

ZeroDrive is built around one important promise:

Your files should be encrypted before they leave your device.

That means the server, the database, and the storage provider should not be able to read your original files. They should only store encrypted data.

The main ZeroDrive app already does this. But we now want to separate the most important reusable parts into their own packages so they can be used in more than one place.

Think of ZeroDrive as a full house.

The app has rooms, doors, lights, locks, furniture, and people walking around. That is the product.

But some tools inside the house are useful anywhere. A good lock, a sealed box, or an emergency recovery kit should not be trapped inside one house. They should be reusable.

That is why we are creating the packages repository.

## Why we created the `zerodrivehq` organization

An organization is a shared home for the project.

Before this, the code lived under one personal GitHub account. That is fine while a project is young. But ZeroDrive is becoming more than one repository and more than one application.

The organization gives the project a proper public home:

```txt
github.com/zerodrivehq
```

The name `zerodrive` itself was already taken, so `zerodrivehq` is a clean alternative.

It means:

```txt
ZeroDrive headquarters
```

Not in a corporate-heavy way, but as the central place where the official ZeroDrive code lives.

This gives us room for:

```txt
github.com/zerodrivehq/zerodrive
github.com/zerodrivehq/packages
```

And later, if needed:

```txt
github.com/zerodrivehq/mobile
github.com/zerodrivehq/docs
```

The organization also gives us a matching package name for npm:

```txt
@zerodrivehq/capsule
@zerodrivehq/recovery
```

That makes it clear these packages belong to the official ZeroDrive project.

## Why the main app and packages are separate

The main ZeroDrive app is the full product.

It includes:

- the website
- the login flow
- the storage page
- the sharing page
- the backend server
- the database
- Google sign-in
- upload and download handling
- MinIO or S3-compatible storage
- user interface and user experience

That is a lot of responsibility.

But the encryption ideas inside ZeroDrive are useful outside the ZeroDrive website too.

For example, imagine another open-source app for storing photos. That app may let people choose where their photos are stored:

- Cloudflare R2
- AWS S3
- MinIO
- local storage
- another storage provider

That photo app still needs a safe way to encrypt files before upload.

It should not need to copy the whole ZeroDrive backend. It should not need the ZeroDrive website. It should not need Google Drive. It should only need the reusable encryption part.

That reusable part is what the packages repository is for.

The split is simple:

```txt
zerodrive
The full app people use.

packages
Reusable tools that other apps can use.
```

## Why the repository is called `packages`

The new repository lives inside the ZeroDrive organization:

```txt
github.com/zerodrivehq/packages
```

We do not need to call it `zerodrive-packages`, because the organization name already says ZeroDrive.

This:

```txt
github.com/zerodrivehq/packages
```

is cleaner than this:

```txt
github.com/zerodrivehq/zerodrive-packages
```

The repository can contain more than one package.

The first two planned packages are:

```txt
@zerodrivehq/capsule
@zerodrivehq/recovery
```

## What is `@zerodrivehq/capsule`?

`capsule` is the main package.

A capsule is a protected container.

Imagine you have a photo called:

```txt
family-photo.jpg
```

Before uploading it anywhere, you put it into a locked container.

Inside the container, ZeroDrive can place:

- the file itself
- the file name
- the file type
- optional message or note
- information needed so the right person can unlock it

Then the entire useful content is encrypted.

The storage provider only sees something that looks like unreadable data.

The idea is:

```txt
normal file
→ encrypted capsule
→ store anywhere
```

The place where you store it does not matter to the capsule.

It could be stored in:

- Google Drive
- Cloudflare R2
- AWS S3
- MinIO
- a private server
- a desktop backup folder
- a mobile app later

The capsule only cares about protecting what is inside.

## Why the name “capsule” is good

The name is useful because it suggests something small, protected, and portable.

A capsule is not the whole app. It is the protected package that carries the important thing inside.

That matches our goal exactly.

ZeroDrive should be able to say:

> We put your file into an encrypted capsule before storing or sharing it.

That sentence is easier to understand than saying:

> We serialize a versioned AES-GCM encrypted envelope with recipient key wrapping.

Both can be true, but the first one is what normal people can understand.

The technical details still matter, but the product language should be simple.

## A normal example

Imagine Aisha wants to send a document to Rahul.

The document is:

```txt
tax-report.pdf
```

Without encryption, a storage service might see:

```txt
filename: tax-report.pdf
type: PDF
content: the full readable file
sender: Aisha
recipient: Rahul
```

That is too revealing.

With capsules, the goal is different.

Aisha’s browser creates a random file key. That key encrypts the document and its private metadata. Then the file key is locked for Rahul using Rahul’s public key.

The server stores the encrypted capsule. The server should not be able to read the document.

Rahul opens the share. His browser uses his private key to unlock the file key. Then his browser decrypts the file.

The important thing is:

The readable file appears only in the browser of someone who has the right key.

## What should be inside the capsule package

The capsule package should include the reusable security building blocks.

It should know how to:

- create a new encrypted capsule from a file
- open a capsule if the user has the right key
- encrypt file metadata like name and type
- detect if encrypted data was changed
- create keys for sharing
- wrap a file key for a recipient
- unwrap a file key using the recipient’s private key
- create stable fingerprints for public keys
- support future format versions
- keep old encrypted files readable when possible

In plain language, it should know how to:

```txt
lock the file
label the lock safely
give the right person a way to unlock it
notice if someone tampered with it
```

## What should not be inside the capsule package

The capsule package should not care where the encrypted file is stored.

It should not include:

- Google Drive upload code
- AWS upload code
- R2 upload code
- MinIO upload code
- database code
- login code
- React pages
- buttons and UI
- analytics
- server routes

That may sound strict, but it is important.

If the capsule package stays focused only on encryption, it becomes easier to trust and easier to reuse.

Another app should be able to use it like this:

```txt
Use capsule to encrypt the file.
Then upload the encrypted result wherever the app wants.
```

That is better than making the encryption package depend on one storage company or one backend design.

## What is `@zerodrivehq/recovery`?

The recovery package is the emergency kit.

It connects to the question:

> What happens if ZeroDrive disappears?

This does not mean ZeroDrive is expected to disappear. It means a good privacy product should be honest about recovery.

If a hosted service goes away, users should understand what they can still recover and what they need in advance.

The recovery package should help create and read backup information.

It can help answer:

- Which encrypted files exist?
- Where are the encrypted capsules?
- What keys or recovery phrase does the user need?
- How can the user restore files from a backup?
- Which parts are still recoverable without the hosted website?

The recovery package should use the capsule package. It should not invent a separate encryption method.

The relationship is:

```txt
capsule
Protects files.

recovery
Helps find and restore protected files later.
```

## A recovery example

Imagine Meera uses ZeroDrive for private file storage.

She has:

- her encrypted files
- her recovery phrase
- a backup manifest

A backup manifest is like a map. It does not need to reveal everything, but it can tell recovery software where encrypted capsules are and how they are organized.

If the hosted ZeroDrive website becomes unavailable, a recovery tool can read the manifest, find the encrypted capsules, and use Meera’s recovery phrase or private keys to restore what can be restored.

In simple words:

```txt
capsules are the locked boxes
recovery manifest is the map
recovery phrase is the proof that you are allowed to unlock your boxes
```

## Why this matters for future apps

You mentioned a possible future file or photo storage product where users can choose their own storage provider.

That is exactly the kind of project this package structure helps.

That future app might say:

```txt
Choose where to store your files:
- R2
- AWS S3
- MinIO
- local server
```

But regardless of the storage choice, the app can still use:

```txt
@zerodrivehq/capsule
```

to encrypt files before upload.

That means storage is flexible, but encryption stays consistent.

This is good because security-sensitive code should not be rewritten again and again for every app.

## Why we should not put everything in one package

It may be tempting to create one package that does everything:

```txt
encrypt files
store files
manage browser keys
upload to S3
restore backups
show UI
```

But that would become messy quickly.

A better split is:

```txt
@zerodrivehq/capsule
The encrypted container.

@zerodrivehq/recovery
Backup and restore helpers.

@zerodrivehq/browser-store
Browser key storage helpers, maybe later.

The main ZeroDrive app
Login, UI, backend, database, storage providers, user flows.
```

This lets each package have one clear job.

## Why browser storage should probably be separate

The capsule package should not directly manage IndexedDB or sessionStorage.

Those are browser features. They are useful, but they make the package more tied to web apps.

A future mobile app or command-line tool may not use IndexedDB at all.

So the clean design is:

```txt
@zerodrivehq/capsule
Works with encryption.

@zerodrivehq/browser-store
Stores keys safely in the browser, if we need it later.
```

This keeps the core package useful in more places.

## What the main ZeroDrive app will still do

The main app still matters. The packages do not replace it.

The app should continue to handle:

- signing in
- showing files
- choosing recipients
- uploading encrypted data
- downloading encrypted data
- managing shared files
- database records
- storage lifecycle
- user interface
- user experience

The packages only provide reusable building blocks.

An analogy:

```txt
ZeroDrive app = the full car
capsule package = the lockbox inside the car
recovery package = the emergency recovery kit
```

You still need the car. But the lockbox and recovery kit can also be useful elsewhere.

## What developers should look at first

When building the packages, developers should look at the current ZeroDrive encryption and sharing code.

Important areas in the main app are:

```txt
packages/crypto
apps/web/src/utils
apps/web/src/pages/share-files.tsx
apps/web/src/pages/shared-with-me.tsx
apps/api/src/routes/sharedFiles.ts
apps/api/src/routes/publicKeys.ts
```

But the goal is not to move the whole app into the package repository.

The goal is to take the reusable encryption ideas and make them cleaner, smaller, better tested, and easier for other projects to use.

## What success looks like

The package work is successful when a developer can install the capsule package and do something like this:

```txt
Take this file.
Encrypt it into a capsule.
Store the capsule anywhere.
Later, open the capsule with the right key.
```

And the user-facing explanation remains simple:

```txt
Your file is locked on your device before upload.
The storage provider stores the locked capsule.
Only someone with the right key can open it.
```

The recovery package is successful when we can honestly explain:

```txt
If the hosted service goes away, this is what you can recover,
this is what you need to keep safe,
and this is how the recovery tool can help.
```

## The final direction

The organization exists so ZeroDrive has a proper public home.

The packages repository exists so the most important reusable parts are not trapped inside the main app.

The capsule package exists to create encrypted portable containers.

The recovery package exists to help users restore access when the normal hosted app is not available.

The main ZeroDrive app remains the product people use.

Together, the structure becomes:

```txt
zerodrivehq/zerodrive
The complete ZeroDrive application.

zerodrivehq/packages
Reusable privacy and recovery packages.

@zerodrivehq/capsule
Encrypted portable file containers.

@zerodrivehq/recovery
Backup and restore helpers.
```

This gives ZeroDrive a stronger foundation. It protects the current app, supports future apps, and makes the encryption model easier to understand, test, and reuse.
