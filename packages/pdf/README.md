# @zerodot/pdf

Work with PDF files: create a file from text, read the text and page count, merge files, pick pages, split a file, and rotate pages. Use it to prepare or read documents in a workflow.

## Install

In zerodot, go to **System > Nodes** and install **PDF**.

Manual: install `@zerodot/pdf` where the web app and the worker run, and add it to `ZERODOT_NODE_PACKAGES`.

## Nodes

### PDF (`file.pdf`)

- Create a PDF from text
- Extract text from a PDF
- Get information about a PDF
- Merge PDF files
- Pick pages from a PDF
- Split a PDF
- Rotate pages of a PDF
- Add a watermark to a PDF
- Add page numbers to a PDF
- Set the title and author of a PDF
- Remove the password from a PDF
- Add a password to a PDF

Create from Text needs no input file. Other operations read the PDF from `binary.<property>` of the input and writes the new file to `binary.<property>` of the output. A split writes `<property>_1`, `<property>_2`, and so on.

## Credential

None.

## License

AGPL-3.0-only
