# @zerodot/spreadsheet

Read and write spreadsheet files: turn a CSV or XLSX file into rows, turn rows into a CSV or XLSX file, convert between the two formats, and list the sheets of a workbook. Use it to move table data in a workflow.

## Install

In zerodot, go to **System > Nodes** and install **Spreadsheet File**.

Manual: install `@zerodot/spreadsheet` where the web app and the worker run, and add it to `ZERODOT_NODE_PACKAGES`.

## Nodes

### Spreadsheet File (`file.spreadsheet`)

- Read rows from a spreadsheet file
- Write rows to a CSV file
- Write rows to an XLSX file
- Convert a spreadsheet file between CSV and XLSX
- List the sheets of an XLSX file

### Read

The node reads the file from `binary.<property>` of the input (default `data`). It gives `rows` (a list of objects), `columns`, and `count`.

- **File Format**: `Detect` uses the file name, the file type, and the first bytes. You can also set CSV or XLSX.
- **First Row Is Header**: On, the first row gives the field names. Off, the fields are named `A`, `B`, `C`, and so on. An empty name becomes `column_N`. A name that repeats gets `_2`, `_3`.
- **Delimiter**: comma, semicolon, tab, or pipe. For CSV only.
- **Sheet Name**: For XLSX only. Empty means the first sheet.
- **Range**: Read only some cells. Examples: `A1:D20`, `B2:`, `A:C`. The range applies before the header row.
- **Skip Empty Rows**: On by default.
- **Parse Numbers and Booleans**: For CSV only. `12` becomes a number and `true` becomes a boolean. Text like `007` stays text. Empty cells are `null`.
- **Row Limit**: Read at most this many rows. 0 means no limit.

XLSX dates are in ISO 8601 text.

### Write

The node writes the new file to `binary.<outputProperty>` of the output. It also gives `rows`, the number of rows written.

- Each input item is one row. Or set **Rows Field** to the name of a field that holds a list of rows. This is useful after a Read node (`rows`).
- **Columns**: Names of the columns, in order, split with commas. Empty means all fields, in the order that they first appear.
- **Write Header Row**: On by default. In XLSX the header is bold.
- A list or an object in a field is written as JSON text.
- **Sheet Name**: For XLSX only. Empty means `Sheet1`. A name has 31 characters or less, and has none of `[ ] : * ? / \`.

### Convert

Changes CSV to XLSX, or XLSX to CSV. The node keeps the cells as they are and does not use a header row. The new file has the same name as the old file and the new extension. **Range** and **Skip Empty Rows** also apply.

### List Sheets

Gives `sheets` (the names) and `count` for an XLSX file. A CSV file has no sheets, and the node gives an error.

## Limits

- The old XLS format is not supported. Save the file as XLSX or CSV.
- The node holds the whole file in memory. The size limit of a node output applies to the new file.
- The node does not read formulas. It reads the last saved value of each cell.
- A cell in a new file that starts with `=`, `+`, `-`, or `@` can run as a formula in some spreadsheet programs. Check the data of other people before you open the file.

## Libraries

| Use        | Library                                                                | License |
| ---------- | ---------------------------------------------------------------------- | ------- |
| Read CSV   | [csv-parse](https://csv.js.org/parse/)                                 | MIT     |
| Write CSV  | [csv-stringify](https://csv.js.org/stringify/)                         | MIT     |
| Read XLSX  | [read-excel-file](https://gitlab.com/catamphetamine/read-excel-file)   | MIT     |
| Write XLSX | [write-excel-file](https://gitlab.com/catamphetamine/write-excel-file) | MIT     |

Why these libraries:

- **Small, few dependencies.** `csv-parse` and `csv-stringify` have no dependencies and ship their own types. `read-excel-file` and `write-excel-file` need only a small ZIP library and an XML parser.
- **Kept up to date.** All four have new releases in 2026.
- **Pure JavaScript.** No native code, unlike `sharp` in Edit Image.
- **Not chosen:** `exceljs` is MIT, but it is about 22 MB, has many old dependencies, and has had no release since December 2024. `xlsx` (SheetJS) on npm is old (0.18.5) and has known security problems. Newer versions are not on npm. `papaparse` has no types in the package.

## Credential

None.

## License

AGPL-3.0-only
