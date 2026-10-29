# @zerodot/ssh

Run commands on a server over SSH, and list, download, upload, rename, and delete files over FTP and SFTP. Use it to manage servers and to move files.

## Install

In zerodot, go to **System > Nodes** and install **SSH, FTP and SFTP**.

Manual: install `@zerodot/ssh` where the web app and the worker run, and add it to `ZERODOT_NODE_PACKAGES`.

## Nodes

### SSH (`ssh.execute`)

Runs a command on a server. You can set the working folder. The node can fail when the exit code is not 0.

### SFTP (`sftp.files`) and FTP (`ftp.files`)

- List files in a folder, also in the subfolders
- Download a file to binary data
- Upload a file from binary data
- Rename or move a file
- Delete a file or a folder

## Credentials

- **SSH** (`ssh`): `host`, `port`, `username`, `authType` (`password` or `privateKey`), `password`, `privateKey`, `passphrase`. The SSH and SFTP nodes use it. The password, the private key, and the passphrase are secret.
- **FTP** (`ftp`): `host`, `port`, `username`, `password`, `secure`. The password is secret.

## License

AGPL-3.0-only
