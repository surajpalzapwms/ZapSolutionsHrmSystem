

import "dotenv/config";
import mongoose from "mongoose";

const APPLY = process.argv.includes("--apply");
const FROM = /\bzaki\s+khan\b/gi; // "Zaki Khan", "ZAKI  KHAN", …
const TO = "Zac";
const SKIP_KEYS = /^(email|password|passwordEncrypted|token|.*Token|.*Hash)$/i;

// Walks a document and returns { "path.to.field": newValue } for every
// string that contains the old name.
const findChanges = (value, path = "", out = {}) => {
  if (typeof value === "string") {
    FROM.lastIndex = 0;
    if (FROM.test(value)) out[path] = value.replace(FROM, TO);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => findChanges(v, path ? `${path}.${i}` : String(i), out));
  } else if (value && typeof value === "object" && !(value instanceof mongoose.Types.ObjectId) && !(value instanceof Date) && !Buffer.isBuffer(value) && value._bsontype === undefined) {
    for (const [k, v] of Object.entries(value)) {
      if (k === "_id" || SKIP_KEYS.test(k)) continue;
      findChanges(v, path ? `${path}.${k}` : k, out);
    }
  }
  return out;
};

const main = async () => {
  if (!process.env.MONGO_URI) throw new Error("Missing MONGO_URI in .env");
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db;
  console.log(APPLY ? "APPLYING changes…\n" : "PREVIEW — nothing is changed. Add --apply to save.\n");

  // 1) The login account: first name "Zaki" + last name "Khan" → "Zac".
  const users = db.collection("users");
  const accounts = await users
    .find({ firstName: /^\s*zaki\s*$/i, lastName: /^\s*khan\s*$/i })
    .project({ email: 1, firstName: 1, lastName: 1 })
    .toArray();
  for (const u of accounts) {
    console.log(`users  ${u._id}  ${u.firstName} ${u.lastName} <${u.email}>  →  ${TO}`);
    if (APPLY) await users.updateOne({ _id: u._id }, { $set: { firstName: TO, lastName: "", name: TO } });
  }

  // 2) Every stored copy of the full name, in every collection.
  let total = accounts.length;
  const collections = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map((c) => c.name)
    .filter((n) => !n.startsWith("system."));
  for (const name of collections) {
    const col = db.collection(name);
    for await (const doc of col.find({})) {
      const changes = findChanges(doc);
      const paths = Object.keys(changes);
      if (!paths.length) continue;
      total += paths.length;
      for (const p of paths) console.log(`${name}  ${doc._id}  ${p}: "${changes[p]}"`);
      if (APPLY) await col.updateOne({ _id: doc._id }, { $set: changes });
    }
  }

  console.log(`\n${total} field(s) ${APPLY ? "updated" : "would be updated"}.`);
  await mongoose.disconnect();
};

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
