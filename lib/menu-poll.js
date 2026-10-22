/**
 * قوائم واتساب ويب المحلي كاختيار يُضغط (Poll).
 * أزرار الرد والقوائم الرسمية موقوفة على واتساب ويب، والاستطلاع هو الشكل
 * المدعوم الذي يقدر العميل يضغط خياره بدل ما يكتب رقماً.
 */

const QUESTION_MAX = 255;
const OPTION_MAX = 100;
const OPTIONS_MAX = 12;
const OPTIONS_MIN = 2;
const MAX_TRACKED = 500;

/** @type {Map<string, { chatId: string, byLabel: Map<string, {id: string, title: string, label: string}>, at: number }>} */
const tracked = new Map();

function menuChoices(menu) {
  if (!menu) return [];
  if (menu.kind === "buttons") return menu.buttons || [];
  if (menu.kind === "list") return menu.rows || [];
  return [];
}

function uniqueLabel(title, used) {
  let label = String(title || "").trim().slice(0, OPTION_MAX);
  if (!label) return "";
  if (!used.has(label)) {
    used.add(label);
    return label;
  }
  let n = 2;
  let next = "";
  do {
    const suffix = ` (${n})`;
    next = `${label.slice(0, OPTION_MAX - suffix.length)}${suffix}`;
    n += 1;
  } while (used.has(next));
  used.add(next);
  return next;
}

/**
 * سؤال + خيارات للاستطلاع. null إذا الخيارات أقل من اثنين.
 */
function buildMenuPollSpec(menu) {
  const choices = menuChoices(menu).filter((item) =>
    String(item?.title || "").trim()
  );
  if (choices.length < OPTIONS_MIN) return null;

  const question =
    String(menu.body || "")
      .replace(/\r\n/g, "\n")
      .trim()
      .slice(0, QUESTION_MAX) || "اختر:";

  const used = new Set();
  const items = [];
  for (const item of choices.slice(0, OPTIONS_MAX)) {
    const title = String(item.title).trim();
    const label = uniqueLabel(title, used);
    if (!label) continue;
    items.push({
      id: String(item.id ?? "").trim(),
      title,
      label,
    });
  }
  if (items.length < OPTIONS_MIN) return null;

  return {
    question,
    options: items.map((item) => item.label),
    items,
  };
}

function messageId(sent) {
  const id = sent?.id;
  if (!id) return "";
  if (typeof id === "string") return id;
  if (id._serialized) return String(id._serialized);
  if (id.id) return String(id.id);
  return "";
}

function rememberMenuPoll(sent, spec, chatId) {
  const id = messageId(sent);
  const to = String(chatId || "").trim();
  if (!id || !spec || !to) return "";
  const byLabel = new Map(spec.items.map((item) => [item.label, item]));
  tracked.set(id, { chatId: to, byLabel, at: Date.now() });
  if (tracked.size > MAX_TRACKED) {
    const oldest = [...tracked.entries()].sort((a, b) => a[1].at - b[1].at);
    const drop = tracked.size - Math.floor(MAX_TRACKED * 0.7);
    for (let i = 0; i < drop; i++) tracked.delete(oldest[i][0]);
  }
  return id;
}

function digitsOf(value) {
  return String(value || "")
    .split("@")[0]
    .replace(/\D/g, "");
}

function isSelfVoter(voter, selfIds) {
  const voterDigits = digitsOf(voter);
  if (!voterDigits) return false;
  return (selfIds || []).some((id) => {
    const selfDigits = digitsOf(id);
    return Boolean(selfDigits) && selfDigits === voterDigits;
  });
}

function chatIdFromParent(parent) {
  if (!parent) return "";
  if (parent.fromMe) return String(parent.to || parent.from || "").trim();
  return String(parent.from || "").trim();
}

/**
 * يحوّل ضغطة العميل إلى نص يفهمه نفس مسار القوائم.
 * تصويت رقم البوت نفسه يُتجاهل.
 */
function resolveMenuPollVote(vote, options = {}) {
  const voter = String(vote?.voter || "");
  if (isSelfVoter(voter, options.selfIds)) return null;

  const selected = Array.isArray(vote?.selectedOptions) ? vote.selectedOptions : [];
  if (!selected.length) return null;
  const label = String(selected[0]?.name || selected[0]?.localName || "").trim();
  if (!label) return null;

  const parent = vote?.parentMessage;
  const pollId = messageId(parent);
  const saved = pollId ? tracked.get(pollId) : null;
  const item = saved?.byLabel?.get(label) || null;
  const chatId = saved?.chatId || chatIdFromParent(parent);
  if (!chatId) return null;

  return {
    pollId,
    chatId,
    voter,
    body: item?.title || label,
    selectedId: item?.id || "",
  };
}

function resetMenuPolls() {
  tracked.clear();
}

module.exports = {
  buildMenuPollSpec,
  rememberMenuPoll,
  resolveMenuPollVote,
  resetMenuPolls,
  messageId,
};
