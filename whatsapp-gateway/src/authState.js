import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BufferJSON, initAuthCreds, proto } from "@whiskeysockets/baileys";

/**
 * A WhatsApp login, on disk, encrypted.
 *
 * Baileys ships `useMultiFileAuthState`, which writes the session as plain JSON files. Those
 * files ARE the clinic's WhatsApp: copy the folder to another machine and it is logged in there
 * too, no phone, no QR. So every file here goes through AES-256-GCM under GATEWAY_SESSION_KEY
 * before it touches the disk — a stolen data folder without the key is noise.
 *
 * Same file-per-key layout as Baileys' own helper (one file per signal key, `creds.json` for the
 * identity), so its behaviour under reconnects and multi-device sync is the well-trodden one.
 * Writes to the same file are serialised, for the reason their helper locks: two concurrent
 * writes to one key file can interleave into an unreadable session.
 */

const FILE_EXT = ".bin";

function fixFileName(file) {
  return String(file).replace(/\//g, "__").replace(/:/g, "-");
}

function encrypt(key, plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

function decrypt(key, blob) {
  if (blob.length < 28) throw new Error("auth file too short");
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const body = blob.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

export async function useEncryptedFileAuthState(folder, key) {
  await mkdir(folder, { recursive: true });

  // One promise chain per path: a write waits for the previous write (or read) of that file.
  const locks = new Map();
  const withLock = (path, fn) => {
    const prev = locks.get(path) || Promise.resolve();
    const next = prev.then(fn, fn);
    locks.set(path, next.catch(() => {}));
    return next;
  };

  const pathFor = (file) => join(folder, fixFileName(file) + FILE_EXT);

  const writeData = (data, file) =>
    withLock(pathFor(file), () => writeFile(pathFor(file), encrypt(key, JSON.stringify(data, BufferJSON.replacer))));

  const readData = (file) =>
    withLock(pathFor(file), async () => {
      try {
        const blob = await readFile(pathFor(file));
        return JSON.parse(decrypt(key, blob), BufferJSON.reviver);
      } catch {
        return null;
      }
    });

  const removeData = (file) =>
    withLock(pathFor(file), async () => {
      try {
        await unlink(pathFor(file));
      } catch {
        /* already gone */
      }
    });

  const creds = (await readData("creds.json")) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}.json`);
              if (type === "app-state-sync-key" && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const file = `${category}-${id}.json`;
              tasks.push(value ? writeData(value, file) : removeData(file));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => writeData(creds, "creds.json"),
    /** Forget the login entirely — after a logout, or when the clinic wants a fresh QR. */
    clear: async () => {
      const files = await readdir(folder).catch(() => []);
      await Promise.all(files.filter((f) => f.endsWith(FILE_EXT)).map((f) => rm(join(folder, f), { force: true })));
    },
  };
}
