const production = document.querySelector("#production");
const cycleRoot = document.querySelector("#cycle");
const proposalsRoot = document.querySelector("#proposals");
const historyRoot = document.querySelector("#history");
const proposalForm = document.querySelector("#proposal-form");
const proposalStatus = document.querySelector("#proposal-status");

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function emptyList(root, message) {
  root.replaceChildren(element("li", message, "empty"));
}

function candidateCard(candidate, cycle) {
  const article = element("article", null, "candidate");
  article.append(element("h3", `Candidate ${candidate.id}`));
  article.append(element("p", candidate.prompt, "prompt"));
  if (candidate.metadata) article.append(element("p", candidate.metadata, "metadata"));

  const preview = element("iframe");
  preview.title = `Candidate ${candidate.id} preview`;
  preview.sandbox = "allow-scripts";
  preview.src = candidate.previewUrl;
  article.append(preview);

  const link = element("a", "Open preview");
  link.href = candidate.previewUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  article.append(link);

  const vote = element("button", cycle.hasVoted ? "Vote recorded" : "Vote for this candidate");
  vote.type = "button";
  vote.disabled = cycle.status !== "open" || cycle.hasVoted;
  vote.addEventListener("click", async () => {
    vote.disabled = true;
    const response = await fetch(`/api/cycles/${cycle.id}/votes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ candidateId: candidate.id }),
    });
    if (!response.ok) {
      const body = await response.json();
      vote.textContent = body.error ?? "Vote failed";
      return;
    }
    await render();
  });
  article.append(vote);

  if (cycle.status !== "open") article.append(element("p", `${candidate.votes} vote${candidate.votes === 1 ? "" : "s"}`));
  if (cycle.winnerCandidateId === candidate.id) article.append(element("strong", "Winner"));
  return article;
}

async function render() {
  const response = await fetch("/api/state", { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error("state unavailable");
  const state = await response.json();
  production.src = state.currentProduction.previewUrl;

  cycleRoot.replaceChildren();
  if (!state.cycle) {
    cycleRoot.append(element("p", "No cycle has started."));
  } else {
    cycleRoot.append(element("p", `${state.cycle.label} · ${state.cycle.status}`));
    const candidates = element("div", null, "candidate-grid");
    for (const candidate of state.cycle.candidates) candidates.append(candidateCard(candidate, state.cycle));
    if (!state.cycle.candidates.length) candidates.append(element("p", "Candidates have not been registered yet."));
    cycleRoot.append(candidates);
  }

  proposalsRoot.replaceChildren();
  for (const proposal of state.proposals) proposalsRoot.append(element("li", proposal.prompt));
  if (!state.proposals.length) emptyList(proposalsRoot, "No prompts yet.");

  historyRoot.replaceChildren();
  for (const release of state.history) {
    const item = element("li");
    item.append(element("strong", `Release ${release.id}: ${release.label}`));
    item.append(element("p", release.prompt));
    const link = element("a", "Open released world");
    link.href = release.previewUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    item.append(link);
    historyRoot.append(item);
  }
  if (!state.history.length) emptyList(historyRoot, "No releases yet.");
}

proposalForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  proposalStatus.textContent = "Submitting…";
  const prompt = new FormData(proposalForm).get("prompt");
  const response = await fetch("/api/proposals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  const body = await response.json();
  proposalStatus.textContent = response.ok ? "Prompt submitted." : body.error;
  if (response.ok) {
    proposalForm.reset();
    await render();
  }
});

render().catch(() => { cycleRoot.textContent = "Control plane unavailable."; });
