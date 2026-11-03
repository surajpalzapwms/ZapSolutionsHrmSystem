// utils/staffIdPrefix.js
// Staff ID prefix of a company, made from its name:
//   two or more words -> first letter of the first two words   "Zap Solutionz" -> ZS
//   one word          -> its first two letters                 "Acme"          -> AC
// Staff IDs are then PREFIX + number: ZS010, ZS011 ... AC010 ...
// Keep this in sync with staffIdPrefixFor() in frontend/src/utils/brand.js.
export const staffIdPrefixFor = (name) => {
  const words = String(name || "")
    .split(/[^A-Za-z0-9]+/)
    .map((w) => w.replace(/[^A-Za-z]/g, ""))
    .filter(Boolean);
  let prefix;
  if (words.length >= 2) prefix = words[0][0] + words[1][0];
  else if (words.length === 1) prefix = words[0].slice(0, 2);
  else prefix = "ST";
  return prefix.toUpperCase().padEnd(2, "X");
};
