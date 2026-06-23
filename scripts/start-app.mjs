const children = [];

function start(name, command, args, cwd) {
  const child = Bun.spawn([command, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });

  children.push({ name, child });
  pipe(child.stdout, name, false);
  pipe(child.stderr, name, true);

  child.exited.then((code) => {
    if (code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
      shutdown(1);
    }
  });
}

async function pipe(stream, name, isError) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    const text = decoder.decode(value);
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue;
      const output = `[${name}] ${line}`;
      if (isError) {
        console.error(output);
      } else {
        console.log(output);
      }
    }
  }
}

let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of children) {
    child.kill();
  }
  setTimeout(() => process.exit(code), 100);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

start("api", "bun", ["start"], "apps/api");
start("worker", "bun", ["start"], "apps/worker");
start("web", "bun", ["dev"], "apps/web");
