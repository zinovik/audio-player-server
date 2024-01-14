#!/usr/bin/env node

const { exec } = require("child_process");
const { promisify } = require("util");
const express = require("express");
const bodyParser = require("body-parser");
const ngrok = require("ngrok");

const getCommandLineParameter = (processArgv, name) => {
  const nameIndex = processArgv.indexOf(name);

  return nameIndex > -1 ? processArgv[nameIndex + 1] : null;
};

const SOURCE_PATH =
  getCommandLineParameter(process.argv, "source-path") ||
  "/media/max/Windows/music";
const PORT = getCommandLineParameter(process.argv, "port") || 3003;
const PASSWORD = getCommandLineParameter(process.argv, "password");

if (!PASSWORD) throw new Error("PASSWORD parameter is required!");

const getPlayerCommand = (filePath) => `mplayer "${filePath}"`;
const getVolumeCommand = (volume) => `amixer sset 'Master' ${volume}%`;
const runCommand = async (command, signal) => {
  const { stdout } = await promisify(exec)(command, {
    maxBuffer: 1024 * 1024 * 4,
    ...(signal ? { signal } : {}),
  });

  return stdout;
};

let filePaths;

(async () => {
  const treeOutput = await runCommand(`tree ${SOURCE_PATH} -f`);

  filePaths = treeOutput
    .split("\n")
    .filter((filePath) => filePath.endsWith(".mp3"))
    .map((filePath) => filePath.substring(filePath.indexOf(SOURCE_PATH)));

  const url = await ngrok.connect({ addr: PORT });
  console.log(url);
})();

const getPage = () => `<!DOCTYPE html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>

  <body>
  <script>
    const password = prompt('Password');

    const handleSongClick = async (element) => {
      const elementText = element.innerHTML.trim();
      const bytes = new TextEncoder().encode(elementText);
      const fileShortPathBase64 = btoa(String.fromCodePoint(...bytes));

      const response = await fetch('/', {
        method: 'POST',
        headers: {
          authorization: password,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ file: fileShortPathBase64 }),
      });
      if (response.status >= 300) alert(await response.json());

      element.style.color = "blue";
    }

    const handleStopClick = async () => {
      const response = await fetch('/stop', {
        method: 'POST',
        headers: { authorization: password },
      });
      if (response.status >= 300) alert(await response.json());
    };

    const handleVolumeClick = async (volume) => {
      const response = await fetch('/volume', {
        method: 'POST',
        headers: {
          authorization: password,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ volume: Number(volume) }),
      });
      if (response.status >= 300) alert(await response.json());
    };
  </script>

  <div style="position: fixed;">
    <button onclick="handleStopClick()">STOP</button>
    <button onclick="handleVolumeClick(0)">Volume 0%</button>
    <button onclick="handleVolumeClick(10)">Volume 10%</button>
    <button onclick="handleVolumeClick(20)">Volume 20%</button>
    <button onclick="handleVolumeClick(30)">Volume 30%</button>
    <button onclick="handleVolumeClick(40)">Volume 40%</button>
    <button onclick="handleVolumeClick(50)">Volume 50%</button>
    <button onclick="handleVolumeClick(60)">Volume 60%</button>
    <button onclick="handleVolumeClick(70)">Volume 70%</button>
    <button onclick="handleVolumeClick(80)">Volume 80%</button>
    <button onclick="handleVolumeClick(90)">Volume 90%</button>
    <button onclick="handleVolumeClick(100)">Volume 100%</button>
  </div>

  <div style="height: 100px;"></div>

  ${filePaths
    .map(
      (filePath) =>
        `<div onClick="handleSongClick(this)" style="cursor: pointer;">${filePath.replace(
          `${SOURCE_PATH}/`,
          ""
        )}</div>`
    )
    .join("\n<hr />\n")}
  </body>
</html>`;

let controller = null;

const stopSong = () => {
  console.log("🟥 STOP SONG");
  if (controller) controller.abort();
};

const startSong = async (filePath) => {
  stopSong();

  controller = new AbortController();

  console.log(`🟢 START SONG: ${filePath}`);

  try {
    await runCommand(getPlayerCommand(filePath), controller.signal);
  } catch (error) {
    // user set a new song
    return;
  }

  // run next song
  controller = null;
  const current = filePaths.indexOf(filePath);
  startSong(filePaths[current + 1]);
};

const setVolume = async (volume) => {
  console.log("🟡 SET VOLUME", volume);

  await runCommand(getVolumeCommand(volume));
};

const app = express();
app.use(bodyParser.json());

app.get("/", (_, res) => {
  res.send(getPage());
});

app.post("/stop", async (req, res) => {
  console.log("🟦 STOP REQUEST");

  if (req.headers.authorization !== PASSWORD) {
    console.warn("wrong password", req.headers.authorization);
    return res.status(401).send('"wrong password"');
  }

  stopSong();

  res.send();
});

app.post("/volume", async (req, res) => {
  console.log("🔷 VOLUME REQUEST", req.body.volume);

  if (req.headers.authorization !== PASSWORD) {
    console.warn("wrong password", req.headers.authorization);
    return res.status(401).send('"wrong password"');
  }

  if (isNaN(req.body.volume) || req.body.volume > 100 || req.body.volume < 0)
    return res.status(400).send('"suspicious request"');

  await setVolume(req.body.volume);

  res.send();
});

app.post("/", (req, res) => {
  console.log(`🔵 SONG REQUEST: ${req.body.file}`);

  if (req.headers.authorization !== PASSWORD) {
    console.warn("wrong password", req.headers.authorization);
    return res.status(401).send('"wrong password"');
  }

  const fileShortPath = Buffer.from(req.body.file, "base64").toString("UTF-8");

  const regExp = new RegExp(
    /[A-zА-яЁё\d\-&() ]+\/\d\d\d\d - [A-zА-яЁё\d\-\[\]&(),! ]+\/\d\d - [A-zА-яЁё\d\-\[\]&(),! ]+.mp3/
  );

  if (!regExp.test(fileShortPath)) {
    console.warn("suspicious request");
    return res.status(400).send('"suspicious request"');
  }

  // we don't wait for the song end here
  startSong(`${SOURCE_PATH}/${fileShortPath}`);

  res.send();
});

app.listen(PORT, () => {
  console.log(`App listening on port ${PORT}`);
});
