// SPDX-License-Identifier: AGPL-3.0-only

// Simple output: Notion data is deep. These functions give the values that people use most.

export type Json = Record<string, unknown>;

export const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** The plain text of a rich text array. */
export function plainText(value: unknown): string {
  return listOf(value)
    .map((part) => (isObject(part) && typeof part.plain_text === "string" ? part.plain_text : ""))
    .join("");
}

const namesOf = (value: unknown): string[] =>
  listOf(value).flatMap((entry) =>
    isObject(entry) && typeof entry.name === "string" ? [entry.name] : [],
  );

const urlOfFile = (file: unknown): string | null => {
  if (!isObject(file)) return null;
  for (const key of ["file", "external"]) {
    const holder = file[key];
    if (isObject(holder) && typeof holder.url === "string") return holder.url;
  }
  return null;
};

/** The value of one property of a page. A type that is not known stays as Notion gave it. */
export function simplifyProperty(property: Json): unknown {
  const type = property.type;
  if (typeof type !== "string") return property;
  const value = property[type];
  switch (type) {
    case "title":
    case "rich_text":
      return plainText(value);
    case "select":
    case "status":
      return isObject(value) && typeof value.name === "string" ? value.name : null;
    case "multi_select":
      return namesOf(value);
    case "people":
      return listOf(value).map((person) => {
        if (!isObject(person)) return null;
        const info = isObject(person.person) ? person.person : {};
        return typeof info.email === "string" ? info.email : (person.name ?? person.id ?? null);
      });
    case "relation":
      return listOf(value).flatMap((entry) =>
        isObject(entry) && typeof entry.id === "string" ? [entry.id] : [],
      );
    case "files":
      return listOf(value).map(urlOfFile);
    case "date":
      return value ?? null;
    case "formula":
    case "rollup":
      return isObject(value) ? (value[String(value.type)] ?? null) : null;
    case "unique_id":
      return isObject(value)
        ? `${typeof value.prefix === "string" ? `${value.prefix}-` : ""}${String(value.number)}`
        : null;
    case "created_by":
    case "last_edited_by":
      return isObject(value) ? (value.name ?? value.id ?? null) : null;
    default:
      return value ?? null;
  }
}

/** A page or a row: the ID, the times, and the simple properties. */
function simplifyPage(page: Json): Json {
  const properties: Json = {};
  if (isObject(page.properties)) {
    for (const [name, property] of Object.entries(page.properties)) {
      properties[name] = isObject(property) ? simplifyProperty(property) : property;
    }
  }
  return {
    id: page.id,
    url: page.url,
    created_time: page.created_time,
    last_edited_time: page.last_edited_time,
    in_trash: page.in_trash ?? false,
    properties,
  };
}

/** A block: the type and the text. Other fields of the content stay under `content`. */
function simplifyBlock(block: Json): Json {
  const type = String(block.type);
  const content = isObject(block[type]) ? block[type] : {};
  const out: Json = {
    id: block.id,
    type,
    has_children: block.has_children ?? false,
    text: plainText(content.rich_text) || (typeof content.title === "string" ? content.title : ""),
  };
  if (typeof content.checked === "boolean") out.checked = content.checked;
  if (typeof content.language === "string") out.language = content.language;
  const url = urlOfFile(content) ?? (typeof content.url === "string" ? content.url : null);
  if (url) out.url = url;
  return out;
}

function simplifyUser(user: Json): Json {
  const person = isObject(user.person) ? user.person : {};
  return {
    id: user.id,
    type: user.type,
    name: user.name ?? null,
    email: typeof person.email === "string" ? person.email : null,
    avatar_url: user.avatar_url ?? null,
  };
}

/** A data source or a database: the title and the name and type of each property. */
function simplifySource(source: Json): Json {
  const properties: Json = {};
  if (isObject(source.properties)) {
    for (const [name, property] of Object.entries(source.properties)) {
      properties[name] = isObject(property) ? property.type : property;
    }
  }
  const out: Json = {
    id: source.id,
    object: source.object,
    title: plainText(source.title),
    url: source.url,
    properties,
  };
  if (Array.isArray(source.data_sources)) out.data_sources = source.data_sources;
  return out;
}

/** The simple form of one Notion object. Other values stay as they are. */
export function simplifyItem(item: unknown): unknown {
  if (!isObject(item)) return item;
  switch (item.object) {
    case "page":
      return simplifyPage(item);
    case "block":
      return simplifyBlock(item);
    case "user":
      return simplifyUser(item);
    case "data_source":
    case "database":
      return simplifySource(item);
    default:
      return item;
  }
}
