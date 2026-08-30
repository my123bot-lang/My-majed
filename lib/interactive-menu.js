/**
 * بناء قوائم واتساب التفاعلية (أزرار / قائمة) بشكل يوافق حدود Cloud API.
 * لا إرسال هنا — فقط تجهيز الحمولة وتقسيم الصفوف.
 */

function normalizeInteractiveBody(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 1024);
}

function listRowsForWhatsApp(rows) {
  return (rows || []).slice(0, 10).map((r, i) => {
    const title = String(r.title || "").slice(0, 24);
    const row = {
      id: String(r.id || i + 1).slice(0, 200),
      title,
    };
    const desc = String(r.description || title).slice(0, 72);
    if (desc) row.description = desc;
    return row;
  });
}

function buttonItemsForWhatsApp(buttons) {
  return (buttons || []).slice(0, 3).map((b, i) => ({
    type: "reply",
    reply: {
      id: String(b.id || i + 1).slice(0, 256),
      title: String(b.title || "").slice(0, 20),
    },
  }));
}

function splitRowsIntoButtonGroups(rows, size = 3) {
  const all = Array.isArray(rows) ? rows.filter((r) => r && r.title) : [];
  const groups = [];
  const n = Math.max(1, Number(size) || 3);
  for (let i = 0; i < all.length; i += n) {
    groups.push(all.slice(i, i + n));
  }
  return groups;
}

/**
 * إذا فشل InteractiveList: نرسل نفس الخيارات كأزرار رد (حدّ 3 لكل رسالة).
 */
function listToButtonMenuChunks(menu, groupSize = 3) {
  const groups = splitRowsIntoButtonGroups(menu?.rows, groupSize);
  return groups.map((rows, i) => ({
    kind: "buttons",
    body:
      i === 0
        ? normalizeInteractiveBody(menu.body)
        : "خيارات إضافية — اختر:",
    buttons: rows.map((r, idx) => ({
      id: String(r.id || idx + 1),
      title: String(r.title || "").slice(0, 20),
    })),
  }));
}

function buildListMessageData(bodyText, buttonText, rows, options = {}) {
  const body = normalizeInteractiveBody(bodyText);
  const listRows = listRowsForWhatsApp(rows);
  if (!body || !listRows.length) {
    throw new Error("قائمة غير صالحة");
  }
  const message = {
    type: "list",
    body: { text: body },
    action: {
      button: String(buttonText || "الخيارات").slice(0, 20),
      sections: [{ title: "الخيارات", rows: listRows }],
    },
  };
  const header = String(options.header || "").trim();
  if (header) {
    message.header = { type: "text", text: header.slice(0, 60) };
  }
  return { message };
}

function buildButtonMessageData(bodyText, buttons, options = {}) {
  const body = normalizeInteractiveBody(bodyText);
  const btns = buttonItemsForWhatsApp(buttons);
  if (!body || !btns.length) {
    throw new Error("أزرار غير صالحة");
  }
  const message = {
    type: "button",
    body: { text: body },
    action: { buttons: btns },
  };
  const header = String(options.header || "").trim();
  if (header) {
    message.header = { type: "text", text: header.slice(0, 60) };
  }
  return { message };
}

module.exports = {
  normalizeInteractiveBody,
  listRowsForWhatsApp,
  buttonItemsForWhatsApp,
  splitRowsIntoButtonGroups,
  listToButtonMenuChunks,
  buildListMessageData,
  buildButtonMessageData,
};
