// app/api/create-anki-deck/route.ts

import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import archiver from "archiver";

type QAPair = {
  question: string;
  answer: string;
};

type InputBody = {
  title: string;
  qa_list: QAPair[];
};

export async function POST(req: NextRequest) {
  console.log("API Route /api/create-anki-deck POST handler invoked");

  let requestBody;
  try {
    requestBody = await req.json();
    console.log("Received request body:", JSON.stringify(requestBody, null, 2));
  } catch (error) {
    console.error("Error parsing request body:", error);
    return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  const { title, qa_list } = requestBody as { title: string; qa_list: QAPair[] };

  if (!title || !Array.isArray(qa_list)) {
    return NextResponse.json({ error: "Missing title or qa_list" }, { status: 400 });
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "anki-deck-"));
  const sqliteFile = path.join(tmpDir, "collection.anki2");
  const mediaFile = path.join(tmpDir, "media");
  const apkgFile = path.join(tmpDir, `${title.replace(/\s+/g, "_")}.apkg`);

  const now = Date.now();
  const MODEL_ID = now;
  const DECK_ID = now;

  function escapeText(str: string) {
    return str.replace(/'/g, "''").replace(/\r?\n/g, "<br>");
  }

  const sqlLines = [
    `PRAGMA user_version = 11;`,
    `CREATE TABLE col(id integer primary key, crt integer, mod integer, scm integer, ver integer, dty integer, usn integer, ls integer, conf text, models text, decks text, dconf text, tags text);`,
    `CREATE TABLE notes(id integer primary key, guid text, mid integer, mod integer, usn integer, tags text, flds text, sfld text, csum integer, flags integer, data text);`,
    `CREATE TABLE cards(id integer primary key, nid integer, did integer, ord integer, mod integer, usn integer, type integer, queue integer, due integer, ivl integer, factor integer, reps integer, lapses integer, left integer, odue integer, odid integer, flags integer, data text);`,
  ];

  const models = {
    [MODEL_ID]: {
      name: "Basic",
      id: MODEL_ID,
      type: 0,
      mod: now,
      usn: 0,
      flds: [{ name: "Front" }, { name: "Back" }],
      tmpls: [
        {
          name: "Card 1",
          qfmt: "{{Front}}",
          afmt: "{{FrontSide}}<hr id=answer>{{Back}}",
        },
      ],
      latexPre:
        "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0pt}\n\\begin{document}",
      latexPost: "\\end{document}",
      css: ".card {\\n font-family: arial;\\n font-size: 20px;\\n color: black;\\n background-color: white;\\n}\\n",
    },
  };

  const decks = {
    [DECK_ID]: {
      name: title,
      id: DECK_ID,
      mod: now,
      usn: 0,
      desc: "",
      dyn: 0,
      collapsed: false,
      conf: 1,
      extendNew: 0,
      extendRev: 0,
    },
  };

  sqlLines.push(`
INSERT INTO col VALUES (
  1,
  ${Math.floor(now / 1000)},
  ${Math.floor(now / 1000)},
  ${now},
  11,
  0,
  0,
  0,
  '${JSON.stringify({
    nextPos: 1,
    estTimes: true,
    activeDecks: [DECK_ID],
    sortType: "noteFld",
    timeLim: 0,
    addToCur: true,
  })}',
  '${JSON.stringify(models).replace(/'/g, "''")}',
  '${JSON.stringify(decks).replace(/'/g, "''")}',
  '{}',
  ''
);
  `);

  let cardId = now;
  let noteId = now;

  qa_list.forEach(({ question, answer }, idx) => {
    noteId++;
    cardId++;

    const guid =
      (Math.random() + 1).toString(36).substring(2, 10) +
      Math.floor(Math.random() * 10000);
    const tags = "";
    const flds = `${escapeText(question)}\u001f${escapeText(answer)}`;
    const sfld = escapeText(question);

    function fieldChecksum(str: string): number {
      let hash = 0,
        i,
        chr;
      str = str.slice(0, 1024);
      for (i = 0; i < str.length; i++) {
        chr = str.charCodeAt(i);
        hash = (hash << 5) - hash + chr;
        hash |= 0;
      }
      return Math.abs(hash >>> 0);
    }

    const csum = fieldChecksum(question);
    const mod = Math.floor(now / 1000);

    sqlLines.push(
      `INSERT INTO notes VALUES (${noteId}, '${guid}', ${MODEL_ID}, ${mod}, 0, '${tags}', '${flds}', '${sfld}', ${csum}, 0, '');`
    );
    sqlLines.push(
      `INSERT INTO cards VALUES (${cardId}, ${noteId}, ${DECK_ID}, 0, ${mod}, 0, 0, 0, ${idx + 1}, 0, 0, 0, 0, 0, 0, 0, 0, '');`
    );
  });

  const sqlFile = path.join(tmpDir, "init.sql");
  await fs.writeFile(sqlFile, sqlLines.join("\n"), "utf8");

  const execSqlite = () =>
    new Promise((resolve, reject) => {
      const sqlite = spawn("sqlite3", [sqliteFile], {
        stdio: ["pipe", "inherit", "inherit"],
      });
      sqlite.stdin.write(`.read ${sqlFile}\n`);
      sqlite.stdin.end();
      sqlite.on("exit", (code) => {
        if (code === 0) resolve(null);
        else reject(new Error("sqlite3 cli returned error"));
      });
    });

  try {
    await execSqlite();
  } catch (err) {
    return NextResponse.json(
      {
        error:
          "sqlite3 cli error: Make sure sqlite3 is installed on the system.",
      },
      { status: 500 }
    );
  }

  // media korrekt als UTF-8 "{}" schreiben
  const mediaContentString = "{}";
  await fs.writeFile(mediaFile, mediaContentString, "utf8");

  const archive = archiver("zip", { zlib: { level: 9 } });
  const buffers: Buffer[] = [];

  archive.on("entry", (entryData) => {
    console.log(
      `Archiver: Processing entry - Name: ${entryData.name}, Size: ${
        entryData.stats ? entryData.stats.size : "N/A"
      }`
    );
  });

  archive.on("data", (chunk: Buffer) => {
    buffers.push(chunk);
  });

  const archiveFinishedPromise = new Promise<void>((resolve, reject) => {
    archive.on("end", () => {
      console.log("Archiving finished successfully.");
      resolve();
    });
    archive.on("error", (err) => {
      console.error("Error during archiving:", err);
      reject(err);
    });
  });

  archive.file(sqliteFile, { name: "collection.anki2" });
  archive.file(mediaFile, { name: "media" });

  archive.finalize();

  try {
    await archiveFinishedPromise;
  } catch (err) {
    await fs
      .rm(tmpDir, { recursive: true, force: true })
      .catch((cleanupErr) =>
        console.error("Error during cleanup after archive failure:", cleanupErr)
      );
    return NextResponse.json(
      { error: "Failed to create .apkg archive" },
      { status: 500 }
    );
  }

  await fs.rm(tmpDir, { recursive: true, force: true });

  const responseBuffer = Buffer.concat(buffers);
  console.log(`Generated .apkg buffer size: ${responseBuffer.length} bytes`);

  if (responseBuffer.length === 0) {
    console.error(
      "Error: Generated .apkg buffer is empty! This likely means an issue with archiver."
    );
    return NextResponse.json(
      { error: "Failed to generate .apkg file (empty archive content)" },
      { status: 500 }
    );
  }

  const headers = new Headers();
  headers.set(
    "Content-Disposition",
    `attachment; filename="${title.replace(/\s+/g, "_")}.apkg"`
  );
  headers.set("Content-Type", "application/octet-stream");

  return new NextResponse(responseBuffer, {
    status: 200,
    headers: headers,
  });
}
