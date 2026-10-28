// SPDX-License-Identifier: AGPL-3.0-only
// Helpers for the where and sort options and for query parameters. Nothing here connects.
import { type FieldSpec, isRecord } from "@zerodot/node-sdk";

export type Param = string | number | boolean | null;
export type Row = Record<string, unknown>;

export const WHERE_OPERATORS = [
  "equal",
  "!=",
  "LIKE",
  ">",
  "<",
  ">=",
  "<=",
  "IS NULL",
  "IS NOT NULL",
] as const;

export type WhereClause = { column: string; condition: string; value?: unknown };
export type SortRule = { column: string; direction?: string };

const OPERATOR_SET = new Set<string>([...WHERE_OPERATORS, "="]);

/** The `where` option: `{ values: [{ column, condition, value }] }`. */
export function readWhereClauses(where: unknown): WhereClause[] {
  if (!isRecord(where) || !Array.isArray(where.values)) return [];
  return where.values.map((clause) => {
    if (
      !isRecord(clause) ||
      typeof clause.column !== "string" ||
      clause.column === "" ||
      typeof clause.condition !== "string" ||
      !OPERATOR_SET.has(clause.condition)
    ) {
      throw new Error("Invalid where clause");
    }
    return { column: clause.column, condition: clause.condition, value: clause.value };
  });
}

/** The `sort` option: `{ values: [{ column, direction }] }`. */
export function readSortRules(sort: unknown): SortRule[] {
  if (!isRecord(sort) || !Array.isArray(sort.values)) return [];
  return sort.values.filter(isRecord).flatMap((rule) =>
    typeof rule.column === "string" && rule.column !== ""
      ? [
          {
            column: rule.column,
            direction: typeof rule.direction === "string" ? rule.direction : undefined,
          },
        ]
      : [],
  );
}

/** A value for a bind parameter. */
export function toParam(value: unknown): Param {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

/** `{ "a": "" }` becomes `{ "a": null }`. The top level only. */
export function replaceEmptyStrings(item: Row): Row {
  return Object.fromEntries(
    Object.entries(item).map(([key, value]) => [key, value === "" ? null : value]),
  );
}

/** Values for `$1`, `$2`... from the text of "Query Parameters". Commas split it. */
export function stringToArray(text: string): string[] {
  return text
    .split(",")
    .filter((entry) => entry)
    .map((entry) => entry.trim());
}

/** The `{{ }}` parts of a text. */
export const getResolvables = (text: string): string[] => text.match(/\{\{[\s\S]*?\}\}/g) ?? [];

/**
 * The values for the query parameters of one item. Each expression gives one value, also when
 * the value has commas. An expression that gives a list gives one value for each element. A
 * missing value is NULL. Without an expression the text splits on commas.
 */
export function queryParameterValues(
  raw: string | undefined,
  evaluate: (expression: string) => unknown,
): Param[] {
  if (!raw) return [];
  const resolvables = getResolvables(raw);
  if (resolvables.length === 0) return stringToArray(raw);
  const values: Param[] = [];
  for (const resolvable of resolvables) {
    const evaluated = evaluate(resolvable);
    if (Array.isArray(evaluated)) {
      for (const element of evaluated) {
        if (element === undefined) values.push(null);
        else if (typeof element === "object" && element !== null)
          values.push(JSON.stringify(element));
        else values.push(toParam(element));
      }
    } else if (evaluated === null || evaluated === undefined) {
      values.push(null);
    } else {
      values.push(typeof evaluated === "object" ? JSON.stringify(evaluated) : String(evaluated));
    }
  }
  return values;
}

/**
 * A query can hold `'$1'` in single quotes. Without "Query Parameters", or with the option on,
 * each one becomes a bind parameter with the text `$1` as its value.
 */

const CONDITION_LABELS: Record<string, string> = {
  equal: "Equal",
  "!=": "Not Equal",
  LIKE: "Like",
  ">": "Greater Than",
  "<": "Less Than",
  ">=": "Greater Than Or Equal",
  "<=": "Less Than Or Equal",
  "IS NULL": "Is Null",
  "IS NOT NULL": "Is Not Null",
};

export const whereSpec: FieldSpec = {
  name: "where",
  label: "Select Rows",
  kind: "fixed",
  multiple: true,
  description: "If not set, all rows will be selected",
  groups: [
    {
      name: "values",
      label: "Condition",
      fields: [
        { name: "column", label: "Column", kind: "string", placeholder: "e.g. ID" },
        {
          name: "condition",
          label: "Operator",
          kind: "options",
          default: "equal",
          description:
            "The operator to check the column against. When using 'LIKE' operator percent sign ( %) matches zero or more characters, underscore ( _ ) matches any single character.",
          options: WHERE_OPERATORS.map((value) => ({
            value,
            label: CONDITION_LABELS[value] ?? value,
          })),
        },
        {
          name: "value",
          label: "Value",
          kind: "string",
          hide: { condition: ["IS NULL", "IS NOT NULL"] },
        },
      ],
    },
  ],
};

export const sortSpec: FieldSpec = {
  name: "sort",
  label: "Sort",
  kind: "fixed",
  multiple: true,
  groups: [
    {
      name: "values",
      label: "Sort rule",
      fields: [
        { name: "column", label: "Column", kind: "string" },
        {
          name: "direction",
          label: "Direction",
          kind: "options",
          default: "ASC",
          options: [
            { value: "ASC", label: "ASC" },
            { value: "DESC", label: "DESC" },
          ],
        },
      ],
    },
  ],
};
