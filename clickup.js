#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TOKEN_PATHS = [
  path.join(os.homedir(), ".clickup", "token"),
  path.join(os.homedir(), ".clickup", "token.txt"),
  path.join(os.homedir(), ".clickup", "config.json"),
];

function readToken() {
  if (process.env.CLICKUP_API_TOKEN) {
    return normalizeToken(process.env.CLICKUP_API_TOKEN);
  }

  for (const tokenPath of TOKEN_PATHS) {
    if (!fs.existsSync(tokenPath)) {
      continue;
    }

    const raw = fs.readFileSync(tokenPath, "utf8").trim();
    if (!raw) {
      continue;
    }

    if (tokenPath.endsWith(".json")) {
      const parsed = JSON.parse(raw);
      const token = parsed.token || parsed.apiToken || parsed.CLICKUP_API_TOKEN;
      if (typeof token === "string" && token.trim()) {
        return normalizeToken(token);
      }
      continue;
    }

    return normalizeToken(raw);
  }

  throw new Error(
    [
      "Could not find a ClickUp API token.",
      "Create ~/.clickup/token with your personal token, or set CLICKUP_API_TOKEN.",
    ].join(" ")
  );
}

function normalizeToken(raw) {
  const trimmed = raw.trim();
  const match = trimmed.match(/pk_[A-Za-z0-9_]+/);
  return match ? match[0] : trimmed;
}

function usage() {
  console.log(
    [
      "Usage:",
      "  node clickup.js me",
      "  node clickup.js teams",
      "  node clickup.js spaces --team <teamId>",
      "  node clickup.js folders --space <spaceId>",
      "  node clickup.js folderless-lists --space <spaceId>",
      "  node clickup.js lists --folder <folderId>",
      "  node clickup.js tasks --list <listId>",
      "  node clickup.js task --id <taskId>",
      "  node clickup.js comments --id <taskId>",
      "  node clickup.js comment --id <taskId> --text <commentText>",
      "  node clickup.js update-task --id <taskId> --status <status>",
      "  node clickup.js update-comment --id <commentId> --json-file <path>",
      "  node clickup.js attach --id <taskId> --file <path>",
      "  node clickup.js search --team <teamId> --name <taskName>",
      "",
      "Token locations checked:",
      ...TOKEN_PATHS.map((p) => `  - ${p}`),
    ].join("\n")
  );
}

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return null;
  }

  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

function readJsonFile(filePath) {
  const resolvedPath = path.resolve(filePath);
  return JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
}

async function clickUpGet(apiPath) {
  const token = readToken();
  const response = await fetch(`https://api.clickup.com/api/v2${apiPath}`, {
    headers: {
      Authorization: token,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ClickUp API ${response.status}: ${body}`);
  }

  return response.json();
}

async function clickUpPost(apiPath, body) {
  const token = readToken();
  const response = await fetch(`https://api.clickup.com/api/v2${apiPath}`, {
    method: "POST",
    headers: {
      Authorization: token,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(`ClickUp API ${response.status}: ${responseBody}`);
  }

  return response.json();
}

async function clickUpPut(apiPath, body) {
  const token = readToken();
  const response = await fetch(`https://api.clickup.com/api/v2${apiPath}`, {
    method: "PUT",
    headers: {
      Authorization: token,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(`ClickUp API ${response.status}: ${responseBody}`);
  }

  return response.json();
}

async function clickUpAttachment(taskId, filePath) {
  const token = readToken();
  const resolvedPath = path.resolve(filePath);
  const blob = await fs.openAsBlob(resolvedPath);
  const form = new FormData();
  const originalName = path.basename(resolvedPath);
  const extension = path.extname(originalName) || ".bin";
  const baseName = path.basename(originalName, extension);
  const safeName = `${baseName.replace(/[^A-Za-z0-9_-]/g, "-")}${extension.toLowerCase()}`;
  const file = new File([blob], safeName, {
    type: blob.type || "application/octet-stream",
  });
  form.append("attachment", file);

  const response = await fetch(`https://api.clickup.com/api/v2/task/${taskId}/attachment`, {
    method: "POST",
    headers: {
      Authorization: token,
      Accept: "application/json",
    },
    body: form,
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(`ClickUp API ${response.status}: ${responseBody}`);
  }

  return response.json();
}

async function getAllTaskComments(taskId) {
  const comments = [];
  let apiPath = `/task/${taskId}/comment`;

  while (true) {
    const response = await clickUpGet(apiPath);
    const pageComments = response.comments || [];
    comments.push(...pageComments);

    if (pageComments.length < 25) {
      break;
    }

    const last = pageComments[pageComments.length - 1];
    apiPath = `/task/${taskId}/comment?start_id=${encodeURIComponent(last.id)}&start=${encodeURIComponent(last.date)}`;
  }

  return comments;
}

async function getAllTeamTasks(teamId) {
  const tasks = [];
  let page = 0;

  while (true) {
    const response = await clickUpGet(
      `/team/${teamId}/task?page=${page}&subtasks=true&include_closed=true`
    );
    const currentTasks = response.tasks || [];
    tasks.push(...currentTasks);

    if (currentTasks.length < 100) {
      break;
    }

    page += 1;
  }

  return tasks;
}

async function searchTasks(teamId, taskName) {
  const tasks = await getAllTeamTasks(teamId);
  const query = taskName.toLowerCase();
  return tasks
    .filter((task) => (task.name || "").toLowerCase().includes(query))
    .map((task) => ({
      taskId: task.id,
      taskName: task.name,
      status: task.status?.status || null,
      url: task.url || null,
      listId: task.list?.id || null,
      listName: task.list?.name || null,
      folderId: task.folder?.id || null,
      folderName: task.folder?.name || null,
      spaceId: task.space?.id || null,
      spaceName: task.space?.name || null,
    }));
}

async function main() {
  const command = process.argv[2];

  if (!command || command === "--help" || command === "-h") {
    usage();
    process.exit(command ? 0 : 1);
  }

  let result;

  switch (command) {
    case "me":
      result = await clickUpGet("/user");
      break;
    case "teams":
      result = await clickUpGet("/team");
      break;
    case "spaces": {
      const teamId = getArg("--team");
      if (!teamId) throw new Error("The spaces command requires --team <teamId>");
      result = await clickUpGet(`/team/${teamId}/space?archived=false`);
      break;
    }
    case "folders": {
      const spaceId = getArg("--space");
      if (!spaceId) throw new Error("The folders command requires --space <spaceId>");
      result = await clickUpGet(`/space/${spaceId}/folder?archived=false`);
      break;
    }
    case "folderless-lists": {
      const spaceId = getArg("--space");
      if (!spaceId) throw new Error("The folderless-lists command requires --space <spaceId>");
      result = await clickUpGet(`/space/${spaceId}/list?archived=false`);
      break;
    }
    case "lists": {
      const folderId = getArg("--folder");
      if (!folderId) throw new Error("The lists command requires --folder <folderId>");
      result = await clickUpGet(`/folder/${folderId}/list?archived=false`);
      break;
    }
    case "tasks": {
      const listId = getArg("--list");
      if (!listId) throw new Error("The tasks command requires --list <listId>");
      result = await clickUpGet(`/list/${listId}/task?subtasks=true`);
      break;
    }
    case "task": {
      const taskId = getArg("--id");
      if (!taskId) throw new Error("The task command requires --id <taskId>");
      result = await clickUpGet(`/task/${taskId}`);
      break;
    }
    case "comments": {
      const taskId = getArg("--id");
      if (!taskId) throw new Error("The comments command requires --id <taskId>");
      result = await getAllTaskComments(taskId);
      break;
    }
    case "comment": {
      const taskId = getArg("--id");
      const text = getArg("--text");
      if (!taskId || !text) {
        throw new Error("The comment command requires --id <taskId> --text <commentText>");
      }
      result = await clickUpPost(`/task/${taskId}/comment`, {
        comment_text: text,
        notify_all: false,
      });
      break;
    }
    case "update-task": {
      const taskId = getArg("--id");
      const status = getArg("--status");
      if (!taskId || !status) {
        throw new Error("The update-task command requires --id <taskId> --status <status>");
      }
      result = await clickUpPut(`/task/${taskId}`, { status });
      break;
    }
    case "update-comment": {
      const commentId = getArg("--id");
      const jsonFile = getArg("--json-file");
      if (!commentId || !jsonFile) {
        throw new Error("The update-comment command requires --id <commentId> --json-file <path>");
      }
      result = await clickUpPut(`/comment/${commentId}`, readJsonFile(jsonFile));
      break;
    }
    case "attach": {
      const taskId = getArg("--id");
      const filePath = getArg("--file");
      if (!taskId || !filePath) {
        throw new Error("The attach command requires --id <taskId> --file <path>");
      }
      result = await clickUpAttachment(taskId, filePath);
      break;
    }
    case "search": {
      const teamId = getArg("--team");
      const taskName = getArg("--name");
      if (!teamId || !taskName) {
        throw new Error("The search command requires --team <teamId> --name <taskName>");
      }
      result = await searchTasks(teamId, taskName);
      break;
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
