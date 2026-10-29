# @zerodot/edit-image

Change an image: get its size, resize, crop, rotate, blur, make it gray, or convert it to JPEG, PNG, WebP, or AVIF. Use it to prepare images before you upload or send them.

## Install

In zerodot, go to **System > Nodes** and install **Edit Image**.

Manual: install `@zerodot/edit-image` where the web app and the worker run, and add it to `ZERODOT_NODE_PACKAGES`.

## Nodes

### Edit Image (`file.edit_image`)

- Get information about an image
- Resize an image (`cover`, `contain`, `fill`, `inside`, or `outside`)
- Crop an image
- Rotate an image
- Blur an image
- Make an image grayscale
- Convert the format of an image (JPEG, PNG, WebP, or AVIF), with a quality setting

The node reads the image from `binary.<property>` of the input and writes the new image to `binary.<property>` of the output (default `data`).

The package uses [sharp](https://sharp.pixelplumbing.com), which has native code.

## Credential

None.

## License

AGPL-3.0-only
