(function () {
  const TOKEN_KEY = "adminToken";
  const LEGACY_KEY = "legacyPass";
  const ROLE_LABELS = { admin: "مدير", editor: "محرر", viewer: "عرض فقط" };

  const PAGE_TITLES = {
    home: "الرئيسية",
    stats: "إحصائية المكالمات",
    leads: "العملاء",
    settings: "بيانات التواصل",
    users: "المستخدمون",
    whatsapp: "الجوالات والإضافات",
    account: "حسابي",
    "user-detail": "تفاصيل المستخدم",
  };

  let currentUser = null;
  let roleLabels = ROLE_LABELS;
  let statsCache = null;
  /** @type {{ slug: string, label: string, waAccountId: string|null, fullAccess: boolean }|null} */
  let portalScope = null;

  const $ = (id) => document.getElementById(id);

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  function setToken(token) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  }

  function setLegacyPass(pass) {
    if (pass) sessionStorage.setItem(LEGACY_KEY, pass);
    else sessionStorage.removeItem(LEGACY_KEY);
  }

  function headers(json = true) {
    const h = {};
    if (json) h["Content-Type"] = "application/json";
    const token = getToken();
    if (token) h.Authorization = "Bearer " + token;
    const legacy = sessionStorage.getItem(LEGACY_KEY);
    if (legacy) h["X-Admin-Password"] = legacy;
    return h;
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: { ...headers(), ...(options.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      setToken("");
      setLegacyPass("");
      currentUser = null;
      showScreen("login");
      throw new Error("انتهت الجلسة — سجّل الدخول مرة أخرى");
    }
    if (!res.ok) {
      throw new Error(
        data.error ||
          (res.status === 404
            ? "الخادم قديم — أغلق نافذة اللوحة (Ctrl+C) ثم شغّل start-admin.bat"
            : `طلب فاشل (${res.status})`)
      );
    }
    return data;
  }

  function showToast(text, ok) {
    const el = $("toast");
    el.textContent = text;
    el.className = "toast visible " + (ok ? "ok" : "err");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.classList.remove("visible"), 4000);
  }

  function isPortalMode() {
    return Boolean(portalScope);
  }

  function parsePortalFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const pathMatch = window.location.pathname.match(/^\/p\/([a-z0-9_-]+)\/?$/i);
    const slug = (
      pathMatch ? pathMatch[1] : params.get("portal") || params.get("p") || ""
    )
      .toLowerCase()
      .trim();
    const key = params.get("k") || params.get("key") || params.get("token");
    if (!slug || !key) return null;
    return { slug, key };
  }

  function applyPortalScope(scope) {
    portalScope = scope || null;
    if (scope?.waAccountId) {
      selectedLeadsWa = scope.waAccountId;
      selectedSettingsWa = scope.waAccountId;
      selectedStatsWa = scope.waAccountId;
      WA_LEADS_TABS = [
        { waAccountId: scope.waAccountId, label: scope.label || scope.waAccountId },
      ];
    }
  }

  async function tryPortalLogin() {
    const p = parsePortalFromUrl();
    if (!p) return false;
    const data = await api(
      `/api/portal/auth?slug=${encodeURIComponent(p.slug)}&k=${encodeURIComponent(p.key)}`
    );
    setToken(data.token);
    setLegacyPass("");
    currentUser = data.user;
    applyPortalScope(data.portal);
    return true;
  }

  function can(perm) {
    if (!currentUser) return false;
    if (Array.isArray(currentUser.effectivePermissions)) {
      return currentUser.effectivePermissions.includes(perm);
    }
    if (currentUser.role === "admin") return true;
    if (currentUser.role === "editor") {
      return perm === "stats:read" || perm === "settings:read" || perm === "settings:write";
    }
    if (currentUser.role === "viewer") return perm === "stats:read";
    return false;
  }

  function showScreen(name) {
    $("screenPortalWait")?.classList.toggle("hidden", name !== "portalWait");
    $("screenLogin").classList.toggle("hidden", name !== "login");
    $("screenSetup").classList.toggle("hidden", name !== "setup");
    $("screenApp").classList.toggle("hidden", name !== "app");
  }

  function updateTopbar(pageId) {
    const el = $("appTopbarTitle");
    if (el) el.textContent = PAGE_TITLES[pageId] || "لوحة التحكم";
  }

  function showPage(pageId, options = {}) {
    if (options.waAccountId !== undefined && !isPortalMode()) {
      if (pageId === "leads") selectedLeadsWa = options.waAccountId;
      if (pageId === "settings") selectedSettingsWa = options.waAccountId;
      if (pageId === "stats") selectedStatsWa = options.waAccountId;
    }
    updateTopbar(pageId);
    ensurePortalBanner(pageId);
    document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
    document.querySelectorAll(".nav-item").forEach((n) => {
      n.classList.toggle("active", n.dataset.page === pageId);
    });
    const page = $("page-" + pageId);
    if (page) page.classList.add("active");

    if (pageId === "home") renderHome();
    if (pageId === "stats") loadStats(true);
    if (pageId === "leads") loadLeads();
    if (pageId === "users") showUsersList();
    if (pageId === "whatsapp") {
      loadWhatsapp();
      startWaPoll();
    } else {
      stopWaPoll();
    }
    if (pageId === "settings") {
      initSettingsWaTabs();
      loadSettings();
    }
  }

  function updateNavVisibility() {
    const portalOnly = isPortalMode() && portalScope?.waAccountId;
    $("navSettings").classList.toggle("hidden", !can("settings:read"));
    $("navUsers").classList.toggle("hidden", !can("users:manage") || portalOnly);
    $("navStats").classList.toggle("hidden", !can("stats:read"));
    $("navLeads")?.classList.toggle("hidden", !can("stats:read"));
    $("navWhatsapp")?.classList.toggle("hidden", !can("whatsapp:manage") || portalOnly);
    $("navHome")?.classList.toggle("hidden", portalOnly);
    $("homeLinkWhatsapp")?.classList.toggle("hidden", !can("whatsapp:manage") || portalOnly);
    $("homeBtnWaAddNew")?.classList.toggle("hidden", !can("whatsapp:manage") || portalOnly);
    $("portalLinksCard")?.classList.toggle("hidden", !can("users:manage") || portalOnly);
    $("saveBtn")?.classList.toggle("hidden", !can("settings:write"));
    $("leadsFollowUpCard")?.classList.toggle("hidden", !can("settings:write"));
    $("settingsForm")
      ?.querySelectorAll("input, select, button[type=submit]")
      .forEach((el) => {
        if (el.id === "saveBtn") return;
        el.disabled = !can("settings:write");
      });

    const name = currentUser?.displayName || currentUser?.username || "—";
    const role = isPortalMode()
      ? "بوابة خارجية"
      : roleLabels[currentUser?.role] || currentUser?.role || "";
    $("userBadge").textContent = name + " · " + role;

    const brandTitle = document.querySelector(".sidebar-brand h2");
    if (brandTitle && isPortalMode()) {
      brandTitle.textContent = portalScope?.label || name;
    }
    const logoutBtn = $("logoutBtn");
    if (logoutBtn && isPortalMode()) logoutBtn.textContent = "إغلاق";
  }

  function ensurePortalBanner(pageId) {
    const page = $("page-" + pageId);
    if (!page || !isPortalMode() || !portalScope?.waAccountId) return;
    let banner = page.querySelector(".portal-scope-banner");
    if (!banner) {
      banner = document.createElement("div");
      banner.className = "portal-scope-banner";
      const header = page.querySelector(".page-header");
      if (header) header.insertAdjacentElement("afterend", banner);
    }
    banner.textContent =
      "لوحة مخصصة: " + (portalScope.label || "") + " — بيانات هذا الجوال فقط";
  }

  async function renderPortalLinks() {
    const card = $("portalLinksCard");
    const list = $("portalLinksList");
    if (!card || !list) return;
    if (!can("users:manage") || isPortalMode()) {
      card.classList.add("hidden");
      return;
    }
    try {
      const data = await api("/api/portal/links");
      card.classList.remove("hidden");
      list.innerHTML = (data.links || [])
        .map(
          (l) =>
            `<div class="portal-link-row">` +
            `<strong>${escapeHtml(l.label)}</strong>` +
            `<span class="muted" style="font-size:0.8rem;">للمشاركة (جوال / جهاز آخر — نفس شبكة الواي فاي). لا تستخدم 169.254 أو 127.0.0.1</span>` +
            `<input type="text" readonly value="${escapeHtml(l.networkUrl || l.url)}" title="انقر للنسخ" onclick="this.select();document.execCommand('copy');" />` +
            `<span class="muted" style="font-size:0.8rem;">على جهاز اللوحة فقط (محلي)</span>` +
            `<input type="text" readonly value="${escapeHtml(l.localUrl || l.url)}" title="انقر للنسخ" onclick="this.select();document.execCommand('copy');" />` +
            `</div>`
        )
        .join("");
    } catch (err) {
      list.innerHTML =
        `<p class="muted">${escapeHtml(err.message)}</p>`;
    }
  }

  async function init() {
    try {
      if (parsePortalFromUrl()) {
        try {
          await tryPortalLogin();
          await enterApp();
          return;
        } catch (err) {
          showScreen("login");
          showToast(err.message || "رابط غير صالح", false);
          return;
        }
      }

      const status = await api("/api/auth/status", { method: "GET" });
      roleLabels = status.roleLabels || ROLE_LABELS;

      if (!status.hasUsers && !status.legacyPassword) {
        showScreen("setup");
        return;
      }

      if (!status.user) {
        showScreen("login");
        return;
      }

      currentUser = status.user;
      if (currentUser.portalScope) applyPortalScope(currentUser.portalScope);
      await enterApp();
    } catch {
      showScreen("login");
    }
  }

  async function enterApp() {
    showScreen("app");
    updateNavVisibility();
    if (!isPortalMode() || portalScope?.fullAccess) {
      await syncWaLeadTabsFromApi();
    }
    initSettingsWaTabs();
    showPage(isPortalMode() && portalScope?.waAccountId ? "leads" : "home");
  }

  async function trySession() {
    try {
      const data = await api("/api/auth/me");
      currentUser = data.user;
      if (currentUser.portalScope) applyPortalScope(currentUser.portalScope);
      await enterApp();
    } catch {
      setToken("");
      portalScope = null;
      if (parsePortalFromUrl()) {
        showScreen("login");
        showToast("انتهت الجلسة — افتح الرابط من جديد", false);
      } else {
        showScreen("login");
      }
    }
  }

  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("loginBtn");
    btn.disabled = true;
    try {
      const loginBody = {
        username: $("loginUsername").value.trim(),
        password: $("loginPassword").value,
      };
      const data = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(loginBody),
      });
      if (data.token) setToken(data.token);
      if (data.legacy) setLegacyPass(loginBody.password);
      else setLegacyPass("");
      currentUser = data.user;
      enterApp();
      showToast("مرحباً " + (currentUser.displayName || currentUser.username), true);
    } catch (err) {
      showToast(err.message, false);
    } finally {
      btn.disabled = false;
    }
  });

  $("setupForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("setupBtn");
    btn.disabled = true;
    try {
      const body = {
        username: $("setupUsername").value.trim() || "admin",
        displayName: $("setupDisplayName").value.trim(),
        password: $("setupPassword").value,
      };
      const data = await api("/api/auth/setup", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (data.token) setToken(data.token);
      currentUser = data.user;
      enterApp();
      showToast("تم إنشاء حساب المدير", true);
    } catch (err) {
      showToast(err.message, false);
    } finally {
      btn.disabled = false;
    }
  });

  $("logoutBtn").addEventListener("click", async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch (_) {}
    setToken("");
    setLegacyPass("");
    currentUser = null;
    showScreen("login");
  });

  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => showPage(btn.dataset.page));
  });

  const MAIN_METRICS = [
    { key: "contacts", label: "جهات تواصل" },
    { key: "conversations", label: "محادثات" },
    { key: "qualified", label: "مؤهلون" },
    { key: "success", label: "نجاح" },
    { key: "rejected", label: "مرفوض" },
  ];

  let selectedStatsWa = "";
  let selectedLeadsWa = "";
  let selectedSettingsWa = "majed";

  let WA_LEADS_TABS = [
    { waAccountId: "majed", label: "ماجد" },
  ];

  async function syncWaLeadTabsFromApi() {
    try {
      const data = await api("/api/leads?limit=1");
      if (data.accountOptions?.length) {
        WA_LEADS_TABS = data.accountOptions.map((a) => ({
          waAccountId: a.id,
          label: a.label,
        }));
      }
    } catch (_) {
      /* يبقى القائمة الافتراضية */
    }
  }

  function waTabsSummaryLabel() {
    return WA_LEADS_TABS.map((a) => a.label).join(" + ");
  }

  function renderWaTabs(container, accountRows, selectedId, onPick) {
    if (!container) return;
    const portalLocked =
      isPortalMode() && portalScope?.waAccountId && !portalScope.fullAccess;
    const tabs = portalLocked
      ? []
      : [{ id: "", label: "الكل" }];
    for (const acc of accountRows || []) {
      const id = acc.waAccountId || acc.id;
      if (!id || id === "admin") continue;
      tabs.push({ id, label: acc.label || id });
    }
    container.innerHTML = tabs
      .map(
        (t) =>
          `<button type="button" class="wa-tab${selectedId === t.id ? " active" : ""}" data-wa="${escapeHtml(t.id)}">${escapeHtml(t.label)}</button>`
      )
      .join("");
    container.querySelectorAll(".wa-tab").forEach((btn) => {
      btn.addEventListener("click", () => onPick(btn.dataset.wa || ""));
    });
  }

  function initSettingsWaTabs() {
    const container = $("settingsWaTabs");
    if (!container) return;
    container.innerHTML = WA_LEADS_TABS.map(
      (t) =>
        `<button type="button" class="wa-tab${selectedSettingsWa === t.waAccountId ? " active" : ""}" data-wa="${escapeHtml(t.waAccountId)}">${escapeHtml(t.label)}</button>`
    ).join("");
    container.querySelectorAll(".wa-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedSettingsWa = btn.dataset.wa || "majed";
        initSettingsWaTabs();
        loadSettings();
      });
    });
    const hint = $("settingsWaHint");
    if (hint) {
      const label =
        WA_LEADS_TABS.find((a) => a.waAccountId === selectedSettingsWa)?.label ||
        "";
      hint.textContent =
        "إعدادات تواصل جوال " + label + " — تظهر للعملاء على هذا الرقم فقط";
    }
  }

  function initLeadsWaSelect() {
    const sel = $("leadsWaSelect");
    if (!sel) return;

    const portalLocked =
      isPortalMode() && portalScope?.waAccountId && !portalScope.fullAccess;

    const options = portalLocked
      ? WA_LEADS_TABS.filter((a) => a.waAccountId === portalScope.waAccountId)
      : [{ waAccountId: "", label: "الكل — كل المستخدمين" }, ...WA_LEADS_TABS];

    sel.innerHTML = options
      .map(
        (a) =>
          `<option value="${escapeHtml(a.waAccountId || "")}">${escapeHtml(a.label)}</option>`
      )
      .join("");

    if (portalLocked && portalScope.waAccountId) {
      selectedLeadsWa = portalScope.waAccountId;
      sel.disabled = true;
    }

    sel.value = selectedLeadsWa || "";

    if (!sel.dataset.bound) {
      sel.dataset.bound = "1";
      sel.addEventListener("change", () => {
        selectedLeadsWa = sel.value || "";
        loadLeads();
      });
    }
  }

  function renderMetricCards(container, bucket, compact) {
    const apps = bucket.applications || { electronic: 0, branch: 0 };
    const items = [
      ...MAIN_METRICS.map((m) => ({ num: bucket[m.key] || 0, lbl: m.label })),
      { num: apps.electronic || 0, lbl: "إلكتروني", highlight: true },
      { num: apps.branch || 0, lbl: "فرع", highlight: true },
    ];
    container.innerHTML = items
      .map(
        (it) =>
          `<div class="stat-card${it.highlight ? " highlight" : ""}${compact ? " compact" : ""}">` +
          `<div class="num">${it.num}</div><div class="lbl">${it.lbl}</div></div>`
      )
      .join("");
  }

  async function renderHome() {
    if (!can("stats:read")) {
      $("homeStats").innerHTML = "<p class='muted'>لا صلاحية لعرض الإحصائية.</p>";
      return;
    }
    try {
      const data = await api("/api/stats");
      statsCache = data;
      const byWa = $("homeByWa");
      if (byWa && data.accounts?.length) {
        byWa.innerHTML = data.accounts
          .map((acc) => {
            const t = acc.today || {};
            return (
              `<div class="wa-account-card">` +
              `<h4>${escapeHtml(acc.label)}</h4>` +
              `<p class="muted" style="margin:0 0 8px;">اليوم</p>` +
              `<p>تواصل <strong>${t.contacts || 0}</strong> · محادثات <strong>${t.conversations || 0}</strong> · مؤهل <strong>${t.qualified || 0}</strong> · نجاح <strong>${t.success || 0}</strong></p>` +
              `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;">` +
              `<button type="button" class="btn-sm btn-secondary wa-goto-leads" data-wa="${escapeHtml(acc.waAccountId)}">متابعة العملاء</button>` +
              `<button type="button" class="btn-sm btn-secondary wa-goto-settings" data-wa="${escapeHtml(acc.waAccountId)}">أرقام التواصل</button>` +
              `<button type="button" class="btn-sm btn-secondary wa-goto-stats" data-wa="${escapeHtml(acc.waAccountId)}">عرض التفاصيل</button>` +
              `</div>` +
              `</div>`
            );
          })
          .join("");
        byWa.querySelectorAll(".wa-goto-stats").forEach((btn) => {
          btn.addEventListener("click", () => {
            selectedStatsWa = btn.dataset.wa || "";
            showPage("stats");
            loadStats(true);
          });
        });
        byWa.querySelectorAll(".wa-goto-leads").forEach((btn) => {
          btn.addEventListener("click", () => {
            showPage("leads", { waAccountId: btn.dataset.wa || "majed" });
          });
        });
        byWa.querySelectorAll(".wa-goto-settings").forEach((btn) => {
          btn.addEventListener("click", () => {
            showPage("settings", { waAccountId: btn.dataset.wa || "majed" });
          });
        });
      } else if (byWa) {
        byWa.innerHTML = "<p class='muted'>لا توجد بيانات بعد — شغّل البوتين واستقبل رسائل.</p>";
      }
      renderMetricCards($("homeToday"), data.today || {}, true);
      const t = data.totals || {};
      $("homeSummary").innerHTML =
        `<p>إجمالي (كل الجوالات): محادثات <strong>${t.conversations || 0}</strong> · ` +
        `مؤهلون <strong>${t.qualified || 0}</strong> · نجاح <strong>${t.success || 0}</strong></p>`;
      await renderPortalLinks();
    } catch (err) {
      $("homeStats").innerHTML = "<p class='muted'>" + err.message + "</p>";
    }
  }

  async function loadStats(force) {
    if (!can("stats:read")) return;
    const loading = $("statsLoading");
    const content = $("statsContent");
    loading.style.display = "block";
    content.style.display = "none";

    try {
      const overview = await api("/api/stats");
      renderWaTabs($("statsWaTabs"), overview.accounts || [], selectedStatsWa, (id) => {
        selectedStatsWa = id;
        loadStats(true);
      });

      const data = selectedStatsWa
        ? await api("/api/stats?waAccountId=" + encodeURIComponent(selectedStatsWa))
        : overview;
      statsCache = data;

      const titleEl = $("statsWaTitle");
      if (titleEl) {
        titleEl.textContent = selectedStatsWa
          ? "عرض: " + (data.label || selectedStatsWa)
          : "عرض: الكل (مجموع " + waTabsSummaryLabel() + " + أي جوال آخر)";
      }

      const updated = data.updatedAt
        ? new Date(data.updatedAt).toLocaleString("ar-SA")
        : "—";
      $("statsUpdated").textContent = "آخر تحديث: " + updated;
      renderMetricCards($("todayGrid"), data.today || {});
      renderMetricCards($("totalsGrid"), data.totals || {});

      const inq = data.totals?.inquiries || {};
      const labels = data.inquiryLabels || {};
      $("inquiryList").innerHTML = Object.keys(labels)
        .map(
          (k) =>
            `<li><span>${labels[k]}</span><span class="count">${inq[k] || 0}</span></li>`
        )
        .join("");

      $("last7Body").innerHTML = (data.last7Days || [])
        .map((row) => {
          const apps = row.applications || {};
          return (
            "<tr>" +
            `<td>${row.date}</td>` +
            `<td>${row.contacts || 0}</td>` +
            `<td>${row.conversations || 0}</td>` +
            `<td>${row.qualified || 0}</td>` +
            `<td>${row.success || 0}</td>` +
            `<td>${row.rejected || 0}</td>` +
            `<td>${apps.electronic || 0}</td>` +
            `<td>${apps.branch || 0}</td></tr>`
          );
        })
        .join("");

      loading.style.display = "none";
      content.style.display = "block";
    } catch (err) {
      loading.textContent = err.message;
    }
  }

  $("refreshStatsBtn")?.addEventListener("click", () => loadStats(true));

  function formatAmount(n) {
    if (n == null || n === "") return "—";
    return Number(n).toLocaleString("ar-SA") + " ر.س";
  }

  function appLabel(row) {
    if (typeof row === "object" && row.comboPackage) return "باقة";
    const m =
      typeof row === "object"
        ? row.applicationMethod ||
          (row.contactDelivery === "electronic_link"
            ? "electronic"
            : row.contactDelivery === "branch"
              ? "branch"
              : null)
        : row;
    if (m === "electronic") return "إلكتروني";
    if (m === "branch") return "فرع";
    return "—";
  }

  function contactLabel(row) {
    const name = row.contactAgentName;
    const phone = row.contactAgentPhone;
    if (!name && !phone) return "—";
    return [name, phone].filter(Boolean).join(" — ");
  }

  function waAccountIdForChatLink(link) {
    let id = String(link.dataset.waId || "").trim();
    if (id) return id;
    if (selectedLeadsWa) return selectedLeadsWa;
    const label = String(link.dataset.waLabel || "").trim();
    if (label) {
      const tab = WA_LEADS_TABS.find(
        (t) => t.label === label || t.waAccountId === label
      );
      if (tab?.waAccountId) return tab.waAccountId;
    }
    return "";
  }

  async function openLeadWhatsAppChat(phone, waAccountId, waLabel) {
    const res = await api("/api/leads/open-chat", {
      method: "POST",
      body: JSON.stringify({ phone, waAccountId, waAccountLabel: waLabel }),
    });
    showToast(
      res.message ||
        (res.autoReplyPaused
          ? `تم فتح المحادثة وإيقاف الرد الآلي لهذا العميل — اضغط «تشغيل الرد الآلي» في القائمة للاستئناف`
          : `تم فتح المحادثة في واتساب ${res.label || waLabel || waAccountId}`),
      true
    );
    if (res.autoReplyPaused) {
      loadLeads().catch(() => {});
    }
  }

  async function setLeadAutoReply(phone, waAccountId, paused) {
    return api("/api/leads/auto-reply", {
      method: "POST",
      body: JSON.stringify({ phone, waAccountId, paused }),
    });
  }

  function bindLeadsChatLinks() {
    const tbody = $("leadsTableBody");
    if (!tbody || tbody.dataset.chatBound) return;
    tbody.dataset.chatBound = "1";
    tbody.addEventListener("click", async (e) => {
      const autoBtn = e.target.closest(".lead-autoreply-btn");
      if (autoBtn) {
        e.preventDefault();
        e.stopPropagation();
        const phone = autoBtn.dataset.phone;
        const waAccountId = autoBtn.dataset.waId || "";
        const currentlyPaused = autoBtn.dataset.paused === "1";
        if (!phone) return;
        autoBtn.disabled = true;
        try {
          const res = await setLeadAutoReply(phone, waAccountId, !currentlyPaused);
          showToast(res.message || (currentlyPaused ? "تم التشغيل" : "تم الإيقاف"), true);
          await loadLeads();
        } catch (err) {
          showToast(err.message, false);
          autoBtn.disabled = false;
        }
        return;
      }

      const link = e.target.closest(".wa-chat-link");
      if (!link) return;
      e.preventDefault();
      const phone = link.dataset.phone;
      const waAccountId = waAccountIdForChatLink(link);
      const waLabel = link.dataset.waLabel || "";
      if (!waAccountId) {
        showToast(
          "لم يُعرف جوال البوت — تأكد أن العميل مسجّل من بوت ماجد",
          false
        );
        return;
      }
      link.classList.add("wa-chat-opening");
      try {
        await openLeadWhatsAppChat(phone, waAccountId, waLabel);
      } catch (err) {
        showToast(err.message, false);
      } finally {
        link.classList.remove("wa-chat-opening");
      }
    });
  }

  const OUTCOME_TABS = [
    { id: "finance_link", label: "أخذ رابط التمويل" },
    { id: "package", label: "أخذ باقة" },
    { id: "limit_exhausted", label: "مستنفذ حد" },
    { id: "service_stop", label: "إيقاف خدمات" },
    { id: "order_number", label: "رقم طلب" },
  ];
  const WORKPLACE_OPTS = [
    { id: "government", label: "حكومي" },
    { id: "private", label: "خاص" },
    { id: "military", label: "عسكري" },
  ];
  const LEADS_PAGE_SIZE = 100;
  let customerDay = "today";
  let followupFilter = "all";
  let leadsCache = [];
  let leadsHasMore = false;
  let lastLeadsPack = null;

  function formatCrmTime(ts) {
    if (!ts) return "—";
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("ar-SA", {
      timeZone: "Asia/Riyadh",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function followupStatusOf(row) {
    if (row?.followUpStatus && row.followUpStatus.label) return row.followUpStatus;
    const q = row?.followUpQueue;
    if (q && (q.status === "pending" || q.status === "processing")) {
      return { sent: false, pending: true, label: "في الطابور" };
    }
    if (q && q.status === "failed" && !row?.followUpSentAt) {
      return { sent: false, failed: true, label: "فشل", error: q.error };
    }
    if (!row?.followUpSentAt) return { sent: false, label: "لم تُرسل متابعة" };
    return { sent: true, label: "تمت المتابعة", at: row.followUpSentAt };
  }

  function followupBadgesHtml(row) {
    const st = followupStatusOf(row);
    if (st.pending) {
      return `<span class="badge pending-follow">في الطابور</span>`;
    }
    if (st.failed) {
      return `<span class="badge paused" title="${escapeHtml(st.error || "")}">فشل المتابعة</span>`;
    }
    if (st.sent) {
      return (
        `<span class="badge followed">${escapeHtml(st.label)}</span>` +
        (st.at ? `<div class="meta-line">آخر متابعة: ${escapeHtml(formatCrmTime(st.at))}</div>` : "")
      );
    }
    return `<span class="badge pending-follow">لم تُرسل متابعة</span>`;
  }

  function workplaceChoicesHtml(row) {
    if (!can("settings:write")) {
      return escapeHtml(row.workplaceLabel || "—");
    }
    const selected = row.workplace || "";
    const buttons = WORKPLACE_OPTS.map((o) => {
      const active = selected === o.id ? " active" : "";
      return `<button type="button" class="work-choice${active}" data-act="workplace" data-workplace="${o.id}" data-lead-id="${escapeHtml(row.id || "")}">${o.label}</button>`;
    }).join("");
    const company = row.employerCompany
      ? `<div class="meta-line">${escapeHtml(row.employerCompany)}</div>`
      : row.workplaceLabel && !selected
        ? `<div class="meta-line">${escapeHtml(row.workplaceLabel)}</div>`
        : "";
    return `<div class="work-choices">${buttons}</div>${company}`;
  }

  function notesChoicesHtml(row) {
    if (!can("settings:write")) {
      return escapeHtml(row.outcomeLabel || "—");
    }
    const selected = row.outcome || "";
    return (
      `<div class="work-choices note-choices">` +
      OUTCOME_TABS.map((o) => {
        const active = selected === o.id ? " active" : "";
        return `<button type="button" class="note-choice${active}" data-act="outcome" data-outcome="${o.id}" data-lead-id="${escapeHtml(row.id || "")}">${o.label}</button>`;
      }).join("") +
      `</div>`
    );
  }

  function crmPhoneCellHtml(row) {
    const waId = row.waAccountId || selectedLeadsWa || "";
    const paused = Boolean(row.autoReplyPaused);
    const link =
      `<a class="phone-link wa-chat-link" href="#" data-phone="${escapeHtml(row.phone)}" data-wa-id="${escapeHtml(waId)}" data-wa-label="${escapeHtml(row.waAccountLabel || "")}" title="فتح المحادثة">${escapeHtml(row.phone)}</a>`;
    return (
      `${link}` +
      `<div class="meta-line">${paused ? '<span class="badge paused">موقوف</span>' : '<span class="badge active">نشط</span>'}</div>` +
      `<div class="meta-line" style="margin-top:6px">${followupBadgesHtml(row)}</div>`
    );
  }

  function crmOrderInputHtml(row) {
    const num = escapeHtml(row.applicationOrderNumber || "");
    if (!can("settings:write")) return num || "—";
    return `<input class="order-input" data-lead-id="${escapeHtml(row.id || "")}" type="text" inputmode="numeric" placeholder="101xxxxx" value="${num}" />`;
  }

  function crmNotesInputHtml(row) {
    const notes = escapeHtml(row.orderStatusNote || "");
    if (!can("settings:write")) return notes || "—";
    return `<textarea class="notes-input" data-lead-id="${escapeHtml(row.id || "")}" rows="2" placeholder="اكتب ملاحظة حرة...">${notes}</textarea>`;
  }

  function crmActionsHtml(row) {
    const id = escapeHtml(row.id || "");
    const phone = escapeHtml(row.phone || "");
    const paused = Boolean(row.autoReplyPaused);
    const waId = escapeHtml(row.waAccountId || selectedLeadsWa || "");
    const canWrite = can("settings:write");
    const followBtn = canWrite
      ? `<button class="btn-primary btn-sm" data-act="ask-order" data-lead-id="${id}" data-phone="${phone}" type="button" title="يرسل سؤال التقديم">سؤال عن الطلب</button>`
      : "";
    const archiveBtn = canWrite
      ? `<button class="btn-secondary btn-sm" data-act="${row.archived ? "unarchive" : "archive"}" data-lead-id="${id}" type="button">${row.archived ? "إلغاء الأرشفة" : "أرشفة"}</button>`
      : "";
    const pauseBtn =
      `<button class="btn-sm ${paused ? "btn-primary" : "btn-secondary"} lead-autoreply-btn" data-phone="${phone}" data-wa-id="${waId}" data-paused="${paused ? "1" : "0"}" type="button">${paused ? "تشغيل" : "إيقاف"}</button>`;
    const delBtn = canWrite
      ? `<button class="btn-sm danger" data-act="delete" data-lead-id="${id}" data-phone="${phone}" type="button">حذف</button>`
      : "";
    return `<div class="actions">${followBtn}${archiveBtn}${pauseBtn}${delBtn}</div>`;
  }

  function setCustomerTab(day) {
    customerDay = day || "today";
    document.querySelectorAll("#customerTabs .crm-tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.day === customerDay);
    });
    const filterRow = $("followupFilterRow");
    if (filterRow) {
      filterRow.classList.toggle("hidden", customerDay !== "finance_link");
    }
  }

  function updateTabCounts(counts) {
    const src = counts || {};
    const set = (id, value) => {
      const el = $(id);
      if (el) el.textContent = value == null || value === "" ? "—" : String(value);
    };
    set("tab-count-today", src.today);
    set("tab-count-yesterday", src.yesterday);
    set("tab-count-all", src.all);
    set("tab-count-finance_link", src.finance_link);
    set("tab-count-order_number", src.order_number);
    set("tab-count-package", src.package);
    set("tab-count-limit_exhausted", src.limit_exhausted);
    set("tab-count-service_stop", src.service_stop);
    set("tab-count-archive", src.archive);
  }

  function updateLiveCounts(counts, persistence) {
    const el = $("live-counts");
    if (!el) return;
    const all = counts?.all ?? persistence?.count ?? 0;
    const today = counts?.today ?? "—";
    const yesterday = counts?.yesterday ?? "—";
    const disk = persistence?.durable ? "قرص دائم" : "تخزين مؤقت";
    el.textContent = `العدد المحفوظ: ${all} · اليوم ${today} · أمس ${yesterday} · ${disk}`;
    el.style.color = Number(all) > 0 ? "var(--ok, #0d6b4c)" : "var(--err, #9d3a2d)";
    updateTabCounts(counts);
  }

  function updatePersistenceUi(persistence) {
    const banner = $("persistenceBanner");
    const line = $("persistenceLine");
    if (!persistence) {
      banner?.classList.add("hidden");
      if (line) line.textContent = "حالة الحفظ: غير متاحة";
      return;
    }
    banner?.classList.toggle("hidden", Boolean(persistence.durable));
    if (line) {
      line.textContent = persistence.durable
        ? `حالة الحفظ: قرص دائم · ${persistence.count || 0} عميل محفوظ · ${persistence.dataDir || ""}`
        : `حالة الحفظ: مؤقت (يُمسح بعد إعادة التشغيل/النشر) · ${persistence.count || 0} عميل · ${persistence.dataDir || ""}`;
      line.style.color = persistence.durable ? "var(--ok, #0d6b4c)" : "var(--err, #9d3a2d)";
    }
  }

  function applyBulkFollowupDefaults(pack) {
    const safe = pack?.outboundSafe || {};
    const msg = $("followUpMessage");
    if (msg && !msg.dataset.loaded && pack?.followUpPreview) {
      msg.value = pack.followUpPreview;
      msg.dataset.loaded = "1";
    }
    const delay = $("bulkFollowUpDelaySec");
    if (delay && !delay.dataset.touched) {
      const sec = Math.max(Math.round((safe.delayMs || safe.minDelayMs || 10000) / 1000), 8);
      delay.value = String(sec);
      delay.min = "8";
    }
    const limit = $("bulkFollowUpLimit");
    if (limit && !limit.dataset.touched) {
      limit.value = String(safe.maxBatchSize || 30);
      limit.max = String(safe.maxBatchSize || 30);
    }
    const quota = $("bulkFollowUpQuota");
    if (quota) {
      const sent = safe.dailySent ?? 0;
      const daily = safe.dailyLimit ?? 80;
      const rem = safe.dailyRemaining ?? Math.max(daily - sent, 0);
      quota.textContent =
        `الحصة اليومية: أُرسل ${sent} من ${daily} · المتبقي ${rem}` +
        ` · تخطّي من توبع خلال ${safe.skipIfFollowedUpWithinHours ?? 20} ساعة`;
    }
  }

  function setLeadsMeta(pack, counts) {
    const shown = leadsCache.length;
    const total = pack.count || pack.total || shown;
    const dayLabel =
      pack.day === "all"
        ? "كل السجل"
        : pack.day === "archive"
          ? "الأرشيف"
          : OUTCOME_TABS.find((o) => o.id === pack.day)?.label || pack.day || "اليوم";
    const el = $("leadsSummary");
    if (el) {
      el.textContent =
        `عرض ${shown} من ${total} · ${dayLabel} · ${pack.timezone || "Asia/Riyadh"}` +
        ` · الكل ${counts.all ?? "—"}` +
        (counts.today != null ? ` · اليوم ${counts.today}` : "") +
        (counts.archive != null ? ` · أرشيف ${counts.archive}` : "");
    }
    $("loadMoreLeadsBtn")?.classList.toggle("hidden", !leadsHasMore);
    updateTabCounts(counts);
  }

  function showLeadsError(msg) {
    const el = $("leadsErrorBanner");
    if (!el) return;
    if (!msg) {
      el.classList.add("hidden");
      el.textContent = "";
      return;
    }
    el.classList.remove("hidden");
    el.textContent = msg;
  }

  function renderCrmCustomers(rows, counts) {
    const body = $("leadsTableBody");
    if (!body) return;
    const q = String($("customerSearch")?.value || "").trim().toLowerCase();
    let filtered = !q
      ? rows.slice()
      : rows.filter((r) => {
          const hay = [
            r.phone,
            r.applicationOrderNumber,
            r.workplaceLabel,
            r.outcomeLabel,
            r.orderStatusNote,
            r.employerCompany,
          ]
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        });

    if (customerDay === "finance_link" && followupFilter !== "all") {
      filtered = filtered.filter((r) => {
        const sent = followupStatusOf(r).sent;
        return followupFilter === "sent" ? sent : !sent;
      });
    }

    if (!filtered.length) {
      const all = counts?.all || 0;
      const tip = all
        ? " جرّب تبويب «الكل» أو فلتر المتابعة."
        : " أكمل محادثات على البوت أو استورد بكب.";
      body.innerHTML = `<tr><td colspan="7" class="empty">لا يوجد عملاء في هذا التبويب.${tip}</td></tr>`;
      return;
    }

    body.innerHTML = filtered
      .map((row) => {
        return (
          `<tr>` +
          `<td data-label="الجوال">${crmPhoneCellHtml(row)}</td>` +
          `<td data-label="تاريخ الإرسال">${escapeHtml(formatCrmTime(row.at))}</td>` +
          `<td data-label="جهة العمل">${workplaceChoicesHtml(row)}</td>` +
          `<td data-label="رقم الطلب">${crmOrderInputHtml(row)}</td>` +
          `<td data-label="وش صار">${notesChoicesHtml(row)}</td>` +
          `<td data-label="ملاحظات">${crmNotesInputHtml(row)}</td>` +
          `<td class="actions" data-label="إجراءات">${crmActionsHtml(row)}</td>` +
          `</tr>`
        );
      })
      .join("");
    bindLeadsChatLinks();
  }

  async function loadFollowUpTemplate() {
    const el = $("followUpMessage");
    if (!el || !can("settings:read") || el.dataset.loaded) return;
    try {
      const data = await api("/api/leads/followup-template");
      if (data.message) el.value = data.message;
      applyBulkFollowupDefaults(data);
      el.dataset.loaded = "1";
    } catch (_) {}
  }

  async function loadLeads({ append = false } = {}) {
    if (!can("stats:read")) return;
    await loadFollowUpTemplate();
    await syncWaLeadTabsFromApi();
    const tbody = $("leadsTableBody");
    initLeadsWaSelect();
    if (!append && tbody) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty">جاري تحميل العملاء...</td></tr>`;
    }
    const wa = selectedLeadsWa;
    const q = String($("customerSearch")?.value || "").trim();
    const offset = append ? leadsCache.length : 0;
    try {
      const params = new URLSearchParams({
        day: customerDay,
        limit: String(LEADS_PAGE_SIZE),
        offset: String(offset),
      });
      if (wa) params.set("waAccountId", wa);
      if (q) params.set("q", q);
      if (customerDay === "finance_link" && followupFilter !== "all") {
        params.set("followupFilter", followupFilter);
      }
      let pack = await api("/api/leads?" + params.toString());
      if (
        !append &&
        customerDay === "today" &&
        !(pack.leads || []).length &&
        (pack.tabCounts?.all || pack.counts?.all || 0) > 0
      ) {
        setCustomerTab("all");
        params.set("day", "all");
        params.set("offset", "0");
        pack = await api("/api/leads?" + params.toString());
      }
      const page = pack.leads || [];
      leadsCache = append ? leadsCache.concat(page) : page;
      leadsHasMore = Boolean(pack.hasMore);
      lastLeadsPack = pack;
      const counts = pack.tabCounts || pack.counts || {};
      if (pack.persistence) updatePersistenceUi(pack.persistence);
      updateLiveCounts(counts, pack.persistence);
      applyBulkFollowupDefaults(pack);
      setLeadsMeta(pack, counts);
      renderCrmCustomers(leadsCache, counts);
      showLeadsError("");

      const fq = pack.followUpQueue || {};
      const statusEl = $("leadsFollowUpStatus");
      if (statusEl && can("settings:write")) {
        if (fq.waiting || fq.sent || fq.failed) {
          statusEl.classList.remove("hidden");
          statusEl.innerHTML =
            `<strong>حالة المتابعة:</strong> ` +
            `⏳ ${fq.waiting || 0} في الطابور · ` +
            `✓ ${fq.sent || 0} أُرسلت · ` +
            `✗ ${fq.failed || 0} فشل`;
        } else if (!statusEl.dataset.keep) {
          statusEl.classList.add("hidden");
        }
      }
    } catch (err) {
      showLeadsError(err.message);
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty">${escapeHtml(err.message)}</td></tr>`;
      }
    }
  }

  async function queueFollowUpMessage({ leadId, confirmText, delayMs, limit }) {
    const message = $("followUpMessage")?.value.trim();
    if (!message) {
      showToast("اكتب نص الرسالة أولاً", false);
      return;
    }
    const wa = selectedLeadsWa;
    const dry = await api("/api/leads/send-followup", {
      method: "POST",
      body: JSON.stringify({
        message,
        waAccountId: wa || undefined,
        leadId: leadId || undefined,
        onlyUnsent: !leadId,
        dryRun: true,
        delayMs,
        limit,
      }),
    });
    if (!dry.count) {
      showToast("لا يوجد عملاء «أخذ رابط التمويل» مطابقون", false);
      return;
    }
    const prompt =
      confirmText ||
      `إرسال الرسالة إلى ${dry.count} عميل؟\n(يجب أن يكون البوت شغّال)`;
    if (!window.confirm(prompt)) return;
    const res = await api("/api/leads/send-followup", {
      method: "POST",
      body: JSON.stringify({
        message,
        waAccountId: wa || undefined,
        leadId: leadId || undefined,
        onlyUnsent: !leadId,
        dryRun: false,
        delayMs,
        limit,
      }),
    });
    showToast(
      `تمت إضافة ${res.queued || res.sent || 0} رسالة للطابور` +
        (res.skipped ? ` · تخطّي ${res.skipped}` : "") +
        (res.dailyRemaining != null ? ` · متبقي اليوم ${res.dailyRemaining}` : ""),
      true
    );
    await loadLeads();
  }

  async function saveCrmField(leadId, path, body) {
    if (!leadId) return;
    await api("/api/leads/" + encodeURIComponent(leadId) + path, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  $("customerTabs")?.addEventListener("click", async (e) => {
    const tab = e.target.closest(".crm-tab");
    if (!tab) return;
    setCustomerTab(tab.dataset.day);
    await loadLeads().catch((err) => showLeadsError(err.message));
  });

  $("followupFilterRow")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-followup-filter]");
    if (!btn) return;
    followupFilter = btn.dataset.followupFilter || "all";
    document.querySelectorAll(".followup-filter").forEach((b) => {
      b.classList.toggle("active", b === btn);
      b.classList.toggle("btn-primary", b === btn);
      b.classList.toggle("btn-secondary", b !== btn);
    });
    renderCrmCustomers(leadsCache, lastLeadsPack?.tabCounts || lastLeadsPack?.counts || {});
  });

  let searchTimer = null;
  $("customerSearch")?.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      renderCrmCustomers(leadsCache, lastLeadsPack?.tabCounts || lastLeadsPack?.counts || {});
    }, 180);
  });

  $("refreshLeadsBtn")?.addEventListener("click", () => loadLeads());
  $("loadMoreLeadsBtn")?.addEventListener("click", () => loadLeads({ append: true }));

  $("copyTodayPhonesBtn")?.addEventListener("click", async () => {
    try {
      const params = new URLSearchParams({ day: "today", phonesOnly: "1" });
      if (selectedLeadsWa) params.set("waAccountId", selectedLeadsWa);
      const pack = await api("/api/leads?" + params.toString());
      const phones = (pack.phones || []).map((r) => r.phone).join("\n");
      await navigator.clipboard.writeText(phones || "");
      showToast(phones ? `تم نسخ ${pack.count} رقم` : "لا توجد أرقام اليوم", Boolean(phones));
    } catch (err) {
      showToast(err.message, false);
    }
  });

  $("exportLeadsBtn")?.addEventListener("click", async () => {
    try {
      const res = await fetch("/api/leads/export", { headers: headers(false) });
      if (!res.ok) throw new Error("فشل التنزيل");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `customers-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      const st = $("backupStatus");
      if (st) {
        st.classList.remove("hidden");
        st.textContent = "تم تنزيل ملف البكب — احفظه عندك قبل أي نشر";
      }
    } catch (err) {
      showToast(err.message, false);
    }
  });

  $("backupNowBtn")?.addEventListener("click", async () => {
    try {
      const r = await api("/api/leads/backup", { method: "POST", body: "{}" });
      const st = $("backupStatus");
      if (st) {
        st.classList.remove("hidden");
        st.textContent = `تم الحفظ: ${r.count || r.summary?.counts?.all || 0} عميل`;
      }
      await loadLeads();
    } catch (err) {
      showToast(err.message, false);
    }
  });

  $("importLeadsBtn")?.addEventListener("click", async () => {
    try {
      const raw = $("importLeadsJson")?.value.trim();
      if (!raw) throw new Error("الصق محتوى ملف البكب أولًا");
      const payload = JSON.parse(raw);
      const r = await api("/api/leads/import", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const st = $("backupStatus");
      if (st) {
        st.classList.remove("hidden");
        st.textContent = `تم الاستيراد: جديد ${r.imported || 0} · محدّث ${r.updated || 0} · الإجمالي ${r.total || 0}`;
      }
      setCustomerTab("all");
      await loadLeads();
    } catch (err) {
      showToast(err.message, false);
    }
  });

  $("leadsTableBody")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    const leadId = btn.dataset.leadId;
    try {
      if (act === "workplace") {
        const row = leadsCache.find((r) => r.id === leadId) || {};
        const next = row.workplace === btn.dataset.workplace ? "clear" : btn.dataset.workplace;
        await saveCrmField(leadId, "/workplace", { workplace: next });
        await loadLeads();
        return;
      }
      if (act === "outcome") {
        const row = leadsCache.find((r) => r.id === leadId) || {};
        const next = row.outcome === btn.dataset.outcome ? "" : btn.dataset.outcome;
        await saveCrmField(leadId, "/outcome", { outcome: next });
        await loadLeads();
        return;
      }
      if (act === "ask-order") {
        btn.disabled = true;
        await queueFollowUpMessage({
          leadId,
          confirmText: `إرسال سؤال التقديم إلى ${btn.dataset.phone}؟`,
        });
        btn.disabled = false;
        return;
      }
      if (act === "archive" || act === "unarchive") {
        await api("/api/leads/" + encodeURIComponent(leadId) + (act === "archive" ? "/archive" : "/unarchive"), {
          method: "POST",
          body: JSON.stringify({ archived: act === "archive" }),
        });
        await loadLeads();
        return;
      }
      if (act === "delete") {
        if (!window.confirm(`حذف العميل ${btn.dataset.phone || ""} من السجل؟\nلا يمكن التراجع.`)) return;
        await api("/api/leads/" + encodeURIComponent(leadId) + "/delete", { method: "POST" });
        showToast("تم حذف العميل من السجل", true);
        await loadLeads();
      }
    } catch (err) {
      showToast(err.message, false);
      btn.disabled = false;
    }
  });

  $("leadsTableBody")?.addEventListener("focusout", async (e) => {
    const notes = e.target.closest("textarea.notes-input");
    if (notes) {
      const leadId = notes.dataset.leadId;
      const current = (leadsCache.find((r) => r.id === leadId) || {}).orderStatusNote || "";
      if (String(notes.value || "") === current) return;
      notes.disabled = true;
      try {
        await saveCrmField(leadId, "/status-note", { note: notes.value });
        const row = leadsCache.find((r) => r.id === leadId);
        if (row) row.orderStatusNote = notes.value;
        notes.style.borderColor = "var(--accent)";
        setTimeout(() => {
          notes.style.borderColor = "";
        }, 700);
      } catch (err) {
        showToast(err.message, false);
      } finally {
        notes.disabled = false;
      }
      return;
    }
    const order = e.target.closest("input.order-input");
    if (order) {
      const leadId = order.dataset.leadId;
      const val = String(order.value || "").replace(/\D/g, "");
      const current = (leadsCache.find((r) => r.id === leadId) || {}).applicationOrderNumber || "";
      if (val === current) return;
      order.disabled = true;
      try {
        await saveCrmField(leadId, "/order-number", { orderNumber: val });
        showToast(val ? "تم حفظ رقم الطلب" : "تم مسح رقم الطلب", true);
        await loadLeads();
      } catch (err) {
        showToast(err.message, false);
        order.value = current;
      } finally {
        order.disabled = false;
      }
    }
  });

  $("leadsTableBody")?.addEventListener("keydown", (e) => {
    const notes = e.target.closest("textarea.notes-input");
    if (notes && e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      notes.blur();
      return;
    }
    const order = e.target.closest("input.order-input");
    if (order && e.key === "Enter") {
      e.preventDefault();
      order.blur();
    }
  });

  ["bulkFollowUpDelaySec", "bulkFollowUpLimit", "followUpMessage"].forEach((id) => {
    $(id)?.addEventListener("input", () => {
      $(id).dataset.touched = "1";
    });
  });

  $("refreshFollowUpQuotaBtn")?.addEventListener("click", async () => {
    try {
      const data = await api("/api/leads/followup-template");
      applyBulkFollowupDefaults(data);
      const st = $("leadsFollowUpStatus");
      if (st) {
        st.classList.remove("hidden");
        st.dataset.keep = "1";
        st.textContent = "تم تحديث الحصة والإعدادات";
      }
    } catch (err) {
      showToast(err.message, false);
    }
  });

  $("sendFollowUpBtn")?.addEventListener("click", async () => {
    const btn = $("sendFollowUpBtn");
    const delaySec = Math.max(Number($("bulkFollowUpDelaySec")?.value || 10), 8);
    const limit = Math.min(Math.max(Number($("bulkFollowUpLimit")?.value || 30), 1), 30);
    btn.disabled = true;
    try {
      await queueFollowUpMessage({
        delayMs: delaySec * 1000,
        limit,
        confirmText:
          `إرسال متابعة جماعية لعملاء «أخذ رابط التمويل»؟\n` +
          `التأخير: ${delaySec} ثانية · حد الدفعة: ${limit}\n` +
          `سيُتخطى من أُرسلت له متابعة مؤخرًا.`,
      });
    } catch (err) {
      showToast(err.message, false);
    } finally {
      btn.disabled = false;
    }
  });

  try {
    const backupPanel = $("backupPanel");
    if (backupPanel && window.matchMedia("(max-width: 720px)").matches) {
      backupPanel.open = false;
    }
  } catch (_) {}
  let waPollTimer = null;
  let selectedWaAccountId = null;
  const WA_STATUS_LABELS = {
    offline: "البوت غير شغّال — start-bot.bat أو start-majed.bat",
    starting: "جاري التشغيل…",
    qr: "بانتظار مسح QR",
    ready: "متصل ويعمل",
    disconnected: "انقطع الاتصال",
    auth_failure: "فشل تسجيل الدخول",
    pending_restart: "يلزم إعادة تشغيل البوت",
  };

  function updateWaAccountMismatch(data, accounts) {
    const el = $("waAccountMismatch");
    if (!el) return;
    const statuses = data.statuses || [];
    const running = statuses.filter((s) => s.botProcessAlive);
    if (data.dualMode && running.length > 1) {
      el.classList.add("hidden");
      el.textContent = "";
      return;
    }

    const cfgActive = (accounts || []).find((a) => a.isActive);
    const activeSt = statuses.find((s) => s.accountId === cfgActive?.id);
    const alive = data.botProcessAlive;
    const runningId = data.accountId;
    const runningLabel = data.label;

    if (
      (data.status === "pending_restart" || activeSt?.status === "pending_restart") &&
      cfgActive
    ) {
      el.classList.remove("hidden");
      el.innerHTML =
        `<strong>يلزم تشغيل البوت</strong> لـ «${escapeHtml(cfgActive.label)}» (${escapeHtml(cfgActive.id)}). ` +
        `<code>start-bot.bat</code> أو <code>start-majed.bat</code>`;
      return;
    }
    if (alive && cfgActive && runningId && cfgActive.id !== runningId && running.length <= 1) {
      el.classList.remove("hidden");
      el.innerHTML =
        `<strong>تنبيه:</strong> البوت يعمل على «${escapeHtml(runningLabel || runningId)}» ` +
        `والمفعّل في اللوحة «${escapeHtml(cfgActive.label)}». ` +
        `شغّل <code>start-bot-account.bat ${escapeHtml(cfgActive.id)}</code> أو التشغيل المزدوج.`;
      return;
    }
    el.classList.add("hidden");
    el.textContent = "";
  }

  function formatWaPhone(digits) {
    const d = String(digits || "").replace(/\D/g, "");
    if (!d) return null;
    if (d.startsWith("9665") && d.length >= 12) {
      return "0" + d.slice(3, 12);
    }
    if (d.startsWith("05") && d.length === 10) return d;
    if (d.startsWith("5") && d.length === 9) return "0" + d;
    return d;
  }

  function renderWaQr(qrText) {
    const box = $("waQrBox");
    const canvas = $("waQrCanvas");
    if (!qrText || typeof QRCode === "undefined") {
      box.style.display = "none";
      return;
    }
    box.style.display = "block";
    QRCode.toCanvas(canvas, qrText, { width: 280, margin: 2 });
  }

  function linkStateBadge(st, alive) {
    if (st === "ready" && alive) {
      return '<span class="badge-wa linked">متصل</span>';
    }
    if (st === "qr" && alive) {
      return '<span class="badge-wa waiting">بانتظار QR</span>';
    }
    return '<span class="badge-wa offline">غير متصل</span>';
  }

  async function loadWhatsapp() {
    if (!can("whatsapp:manage")) return;
    try {
      const data = await api("/api/whatsapp/status");
      const statuses = data.statuses || [];
      const statusById = {};
      for (const s of statuses) statusById[s.accountId] = s;

      const runningCount =
        data.runningCount ?? statuses.filter((s) => s.botProcessAlive).length;
      const totalAccounts = data.totalAccounts ?? statuses.length;

      if (!selectedWaAccountId) {
        const withQr = statuses.find(
          (s) => s.status === "qr" && s.qr && s.botProcessAlive
        );
        selectedWaAccountId = withQr?.accountId || data.accountId || null;
      }

      const qrSt = selectedWaAccountId
        ? statusById[selectedWaAccountId]
        : data;
      const st = qrSt?.status || data.status || "offline";
      const alive = qrSt?.botProcessAlive ?? data.botProcessAlive;

      let line;
      if (runningCount > 1) {
        line = `تشغيل متعدد: ${runningCount} من ${totalAccounts} بوت شغّال`;
      } else if (runningCount === 1) {
        const one = statuses.find((s) => s.botProcessAlive);
        line = `${WA_STATUS_LABELS[one?.status] || one?.status || "يعمل"} — ${one?.label || one?.accountId}`;
      } else {
        line = WA_STATUS_LABELS[st] || st;
        if (data.label && data.accountId) line += ` — ${data.label}`;
      }
      $("waStatusText").textContent = line;

      const phoneEl = $("waActivePhone");
      const qrLabelEl = $("waQrAccountLabel");
      if (phoneEl) {
        const display = formatWaPhone(qrSt?.phone || data.phone);
        const who = qrSt?.label || data.label;
        phoneEl.textContent = display
          ? `رقم واتساب (${who}): ${display}`
          : st === "qr" && alive
            ? `بانتظار مسح QR — ${who || ""}`
            : "";
      }
      if (qrLabelEl) {
        qrLabelEl.textContent =
          selectedWaAccountId && qrSt?.label
            ? `عرض QR لـ: ${qrSt.label} (${selectedWaAccountId})`
            : "";
      }

      if (st === "qr" && qrSt?.qr && alive) renderWaQr(qrSt.qr);
      else $("waQrBox").style.display = "none";

      const tbody = $("waAccountsBody");
      const accounts = data.accounts || [];
      updateWaAccountMismatch(data, accounts);
      tbody.innerHTML = accounts
        .map((a) => {
          const accSt = statusById[a.id] || {
            status: "offline",
            botProcessAlive: false,
          };
          const phone = accSt.phone
            ? formatWaPhone(accSt.phone) || accSt.phone
            : "—";
          const linkBadge = linkStateBadge(accSt.status, accSt.botProcessAlive);
          const running = accSt.botProcessAlive
            ? '<span class="badge-status qualified">البوت شغّال</span>'
            : "—";
          const showQrBtn =
            accSt.status === "qr" && accSt.botProcessAlive
              ? ` <button type="button" class="btn-sm wa-show-qr" data-id="${escapeHtml(a.id)}">عرض QR</button>`
              : "";
          return (
            "<tr>" +
            `<td>${escapeHtml(a.label)}</td>` +
            `<td><strong>${escapeHtml(phone)}</strong></td>` +
            `<td><code>${escapeHtml(a.id)}</code></td>` +
            `<td>${linkBadge} ${running}</td>` +
            `<td class="actions">` +
            showQrBtn +
            (a.isActive
              ? ""
              : ` <button type="button" class="btn-sm wa-activate" data-id="${escapeHtml(a.id)}" data-label="${escapeHtml(a.label)}">تفعيل</button>`) +
            (!a.isActive && accounts.length > 1
              ? ` <button type="button" class="btn-sm btn-del wa-delete" data-id="${escapeHtml(a.id)}">حذف</button>`
              : "") +
            `</td></tr>`
          );
        })
        .join("");

      tbody.querySelectorAll(".wa-show-qr").forEach((btn) => {
        btn.addEventListener("click", () => {
          selectedWaAccountId = btn.dataset.id;
          loadWhatsapp();
          goToWaQrSection();
        });
      });

      tbody.querySelectorAll(".wa-activate").forEach((btn) => {
        btn.addEventListener("click", async () => {
          try {
            const r = await api("/api/whatsapp/accounts/" + btn.dataset.id + "/activate", {
              method: "POST",
            });
            const label = btn.dataset.label || btn.dataset.id;
            const id = btn.dataset.id;
            showToast(
              `تم تفعيل «${label}». شغّل start-bot.bat أو start-majed.bat.`,
              true
            );
            showWaChromeBanner();
            await loadWhatsapp();
            goToWaQrSection();
          } catch (err) {
            showToast(err.message, false);
          }
        });
      });
      tbody.querySelectorAll(".wa-delete").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm("حذف هذا الحساب؟")) return;
          try {
            await api("/api/whatsapp/accounts/" + btn.dataset.id, { method: "DELETE" });
            showToast("تم الحذف", true);
            loadWhatsapp();
          } catch (err) {
            showToast(err.message, false);
          }
        });
      });
    } catch (err) {
      $("waStatusText").textContent = err.message;
    }
  }

  function startWaPoll() {
    stopWaPoll();
    waPollTimer = setInterval(() => {
      if ($("page-whatsapp")?.classList.contains("active")) loadWhatsapp();
    }, 3000);
  }

  function stopWaPoll() {
    if (waPollTimer) clearInterval(waPollTimer);
    waPollTimer = null;
  }

  let waHighlightTimer = null;

  function highlightWaSection(el) {
    if (!el) return;
    el.classList.add("wa-highlight");
    if (waHighlightTimer) clearTimeout(waHighlightTimer);
    waHighlightTimer = setTimeout(() => el.classList.remove("wa-highlight"), 4000);
  }

  function showWaChromeBanner() {
    $("waChromeBanner")?.classList.remove("hidden");
  }

  function goToWaQrSection() {
    showPage("whatsapp");
    showWaChromeBanner();
    const section = $("waQrSection");
    section?.scrollIntoView({ behavior: "smooth", block: "start" });
    highlightWaSection(section);
    loadWhatsapp();
  }

  function goToWaAddSection() {
    showPage("whatsapp");
    const section = $("waAddSection");
    section?.scrollIntoView({ behavior: "smooth", block: "start" });
    highlightWaSection(section);
    setTimeout(() => $("waLabel")?.focus(), 400);
  }

  $("btnWaAddNew")?.addEventListener("click", goToWaAddSection);
  $("btnWaGoQr")?.addEventListener("click", goToWaQrSection);
  $("homeBtnWaAddNew")?.addEventListener("click", goToWaAddSection);
  $("waRefreshQr")?.addEventListener("click", () => loadWhatsapp());

  $("btnUsersAddNew")?.addEventListener("click", () => {
    showPage("users");
    const section = $("usersAddSection");
    section?.scrollIntoView({ behavior: "smooth", block: "start" });
    highlightWaSection(section);
    setTimeout(() => $("newUsername")?.focus(), 400);
  });

  document.querySelectorAll(".quick-link[data-goto]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const wa = btn.dataset.wa;
      showPage(
        btn.dataset.goto,
        wa !== undefined ? { waAccountId: wa } : {}
      );
    });
  });

  $("addWaForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const res = await api("/api/whatsapp/accounts", {
        method: "POST",
        body: JSON.stringify({
          label: $("waLabel").value.trim(),
          id: $("waId").value.trim() || undefined,
        }),
      });
      const newId = res.account?.id;
      if (newId) {
        try {
          await api("/api/whatsapp/accounts/" + newId + "/activate", { method: "POST" });
        } catch (_) {}
      }
      $("addWaForm").reset();
      showToast("تمت الإضافة — أعد تشغيل start-bot.bat ثم امسح QR", true);
      await loadWhatsapp();
      goToWaQrSection();
    } catch (err) {
      showToast(err.message, false);
    }
  });

  const SETTINGS_FIELD_IDS = [
    "personalAgentName",
    "personalAgentPhone",
    "branchEmployeeName",
    "branchEmployeePhone",
    "propertyComboAgentName",
    "propertyComboAgentPhone",
    "propertyComboAgentPhone2",
    "propertyComboContactFooter",
    "portalUrl",
    "serviceStopAgentName",
    "serviceStopAgentPhone",
    "serviceStopContactHint",
    "ownerControlPhones",
  ];

  function applySettingsToForm(data) {
    if (!data) return;
    for (const id of SETTINGS_FIELD_IDS) {
      const el = $(id);
      if (!el) continue;
      if (id === "personalAgentName") {
        el.value = data.personalAgentName || data.employeeName || "";
      } else if (id === "personalAgentPhone") {
        el.value = data.personalAgentPhone || data.employeePhone || "";
      } else {
        el.value = data[id] || "";
      }
    }
    updatePreviews();
  }

  function collectSettingsForm() {
    const body = {};
    const missing = [];
    for (const id of SETTINGS_FIELD_IDS) {
      const el = $(id);
      if (!el) {
        missing.push(id);
        continue;
      }
      body[id] = String(el.value || "").trim();
    }
    if (missing.length) {
      throw new Error(
        "واجهة قديمة — اضغط Ctrl+F5 لتحديث الصفحة ثم أعد الحفظ"
      );
    }
    return body;
  }

  async function loadSettings() {
    if (!can("settings:read")) return;
    try {
      const data = await api(
        "/api/settings?waAccountId=" + encodeURIComponent(selectedSettingsWa)
      );
      applySettingsToForm(data);
    } catch (err) {
      showToast(err.message, false);
    }
  }

  function telHref(phone) {
    const p = String(phone || "").replace(/\D/g, "");
    if (!p) return "#";
    const full = p.startsWith("0") ? "+966" + p.slice(1) : "+" + p;
    return "tel:" + full;
  }

  function updatePreviews() {
    $("personalTelPreview").href = telHref($("personalAgentPhone").value);
    $("branchTelPreview").href = telHref($("branchEmployeePhone").value);
    $("propertyComboTelPreview").href = telHref($("propertyComboAgentPhone").value);
    $("urlPreview").href = $("portalUrl").value.trim() || "#";
    $("serviceStopTelPreview").href = telHref($("serviceStopAgentPhone").value);
  }

  [
    "personalAgentPhone",
    "branchEmployeePhone",
    "propertyComboAgentPhone",
    "portalUrl",
    "serviceStopAgentPhone",
  ].forEach((id) => {
    $(id)?.addEventListener("input", updatePreviews);
  });

  $("settingsForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!can("settings:write")) {
      showToast("ليس لديك صلاحية التعديل", false);
      return;
    }
    const btn = $("saveBtn");
    btn.disabled = true;
    try {
      const payload = collectSettingsForm();
      payload.waAccountId = selectedSettingsWa;
      const res = await api("/api/settings", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      applySettingsToForm(res.settings || res);
      const label =
        WA_LEADS_TABS.find((a) => a.waAccountId === selectedSettingsWa)?.label ||
        "";
      showToast("تم حفظ إعدادات " + label + " — البوت يقرأها فوراً", true);
    } catch (err) {
      showToast(err.message, false);
    } finally {
      btn.disabled = !can("settings:write");
    }
  });

  let userDetailRolePresets = [];

  function showUsersList() {
    document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
    $("page-users")?.classList.add("active");
    document.querySelectorAll(".nav-item").forEach((n) => {
      n.classList.toggle("active", n.dataset.page === "users");
    });
    updateTopbar("users");
    loadUsers();
  }

  function showUserDetailPage() {
    document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
    $("page-user-detail")?.classList.add("active");
    updateTopbar("user-detail");
    document.querySelectorAll(".nav-item").forEach((n) => {
      n.classList.toggle("active", n.dataset.page === "users");
    });
  }

  function getCheckedPermissions() {
    return [...document.querySelectorAll(".user-perm-cb:checked")].map((el) => el.value);
  }

  function setPermissionCheckboxes(perms) {
    const set = new Set(perms || []);
    document.querySelectorAll(".user-perm-cb").forEach((cb) => {
      cb.checked = set.has(cb.value);
    });
    updateUserDetailCustomBadge();
  }

  function permissionsEqual(a, b) {
    const x = [...(a || [])].sort().join(",");
    const y = [...(b || [])].sort().join(",");
    return x === y;
  }

  function rolePresetPermissions(role) {
    const preset = userDetailRolePresets.find((p) => p.role === role);
    return preset ? preset.permissions : [];
  }

  function updateUserDetailCustomBadge() {
    const role = $("userDetailRole")?.value;
    const checked = getCheckedPermissions();
    const preset = rolePresetPermissions(role);
    const custom = !permissionsEqual(checked, preset);
    $("userDetailCustomBadge")?.classList.toggle("hidden", !custom);
    if ($("userDetailUseCustom")) {
      $("userDetailUseCustom").checked = custom;
    }
  }

  function renderUserDetailPerms(options, selected) {
    const box = $("userDetailPerms");
    if (!box) return;
    box.innerHTML = (options || [])
      .map(
        (opt) =>
          `<label class="perm-item"><input type="checkbox" class="user-perm-cb" value="${escapeHtml(opt.key)}" />` +
          `<span>${escapeHtml(opt.label)}</span></label>`
      )
      .join("");
    setPermissionCheckboxes(selected);
    box.querySelectorAll(".user-perm-cb").forEach((cb) => {
      cb.addEventListener("change", updateUserDetailCustomBadge);
    });
  }

  function renderRolePresetButtons() {
    const box = $("userDetailRolePresets");
    if (!box) return;
    box.innerHTML = userDetailRolePresets
      .map(
        (p) =>
          `<button type="button" data-role="${escapeHtml(p.role)}">قالب: ${escapeHtml(p.label)}</button>`
      )
      .join("");
    box.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        $("userDetailRole").value = btn.dataset.role;
        setPermissionCheckboxes(rolePresetPermissions(btn.dataset.role));
      });
    });
  }

  async function openUserDetail(userId) {
    if (!can("users:manage")) return;
    showUserDetailPage();
    $("userDetailForm")?.reset();
    $("userDetailTitle").textContent = "جاري التحميل…";
    try {
      const data = await api("/api/users/" + userId);
      const u = data.user;
      userDetailRolePresets = data.rolePresets || [];

      $("userDetailId").value = u.id;
      $("userDetailTitle").textContent = u.displayName;
      $("userDetailSubtitle").textContent = "@" + u.username;
      $("userDetailDisplayName").value = u.displayName;
      $("userDetailUsername").value = u.username;
      $("userDetailRole").value = u.role;
      $("userDetailActive").checked = u.active;
      $("userDetailActive").disabled = u.id === currentUser.id;
      $("userDetailMeta").textContent =
        "أُنشئ: " +
        formatDate(u.createdAt) +
        " · آخر دخول: " +
        formatDate(u.lastLoginAt);

      renderUserDetailPerms(data.permissionOptions, u.effectivePermissions);
      renderRolePresetButtons();

      const self = u.id === currentUser.id;
      $("userDetailDeleteBtn").classList.toggle("hidden", self);
      $("userDetailRole").disabled = self;
    } catch (err) {
      showToast(err.message, false);
      showUsersList();
    }
  }

  async function loadUsers() {
    const tbody = $("usersTableBody");
    tbody.innerHTML = "<tr><td colspan='5'>جاري التحميل…</td></tr>";
    try {
      const data = await api("/api/users");
      if (data.roleLabels) roleLabels = { ...roleLabels, ...data.roleLabels };
      tbody.innerHTML = data.users
        .map((u) => {
          const custom = u.usesCustomPermissions
            ? ' <span class="badge-custom-perms">مخصص</span>'
            : "";
          return (
            "<tr>" +
            `<td><strong>${escapeHtml(u.displayName)}</strong><br><span class="muted">@${escapeHtml(u.username)}</span></td>` +
            `<td>${escapeHtml(roleLabels[u.role] || u.role)}${custom}</td>` +
            `<td>${u.active ? "نعم" : "لا"}</td>` +
            `<td class="muted">${formatDate(u.lastLoginAt)}</td>` +
            `<td class="actions">` +
            `<button type="button" class="btn-sm btn-manage-user" data-id="${escapeHtml(u.id)}">إدارة</button>` +
            `</td></tr>`
          );
        })
        .join("");

      tbody.querySelectorAll(".btn-manage-user").forEach((btn) => {
        btn.addEventListener("click", () => openUserDetail(btn.dataset.id));
      });
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  $("btnUserDetailBack")?.addEventListener("click", showUsersList);

  $("userDetailRole")?.addEventListener("change", () => {
    setPermissionCheckboxes(rolePresetPermissions($("userDetailRole").value));
  });

  $("userDetailForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = $("userDetailId").value;
    const p1 = $("userDetailPassword").value;
    const p2 = $("userDetailPassword2").value;
    if (p1 || p2) {
      if (p1 !== p2) {
        showToast("كلمتا المرور غير متطابقتين", false);
        return;
      }
      if (p1.length < 6) {
        showToast("كلمة المرور 6 أحرف على الأقل", false);
        return;
      }
    }

    const role = $("userDetailRole").value;
    const checked = getCheckedPermissions();
    const preset = rolePresetPermissions(role);
    const useCustom = $("userDetailUseCustom")?.checked;
    const body = {
      displayName: $("userDetailDisplayName").value.trim(),
      role,
      active: $("userDetailActive").checked,
    };
    if (useCustom || !permissionsEqual(checked, preset)) {
      body.permissions = checked;
    } else {
      body.permissions = null;
    }

    $("userDetailSaveBtn").disabled = true;
    try {
      await api("/api/users/" + id, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      if (p1) {
        await api("/api/users/" + id + "/password", {
          method: "POST",
          body: JSON.stringify({ password: p1 }),
        });
        $("userDetailPassword").value = "";
        $("userDetailPassword2").value = "";
      }
      showToast("تم حفظ إعدادات المستخدم", true);
      await openUserDetail(id);
    } catch (err) {
      showToast(err.message, false);
    } finally {
      $("userDetailSaveBtn").disabled = false;
    }
  });

  $("userDetailDeleteBtn")?.addEventListener("click", async () => {
    const id = $("userDetailId").value;
    if (!id) return;
    await deleteUser(id);
    showUsersList();
  });

  $("addUserForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/api/users", {
        method: "POST",
        body: JSON.stringify({
          username: $("newUsername").value.trim(),
          displayName: $("newDisplayName").value.trim(),
          password: $("newPassword").value,
          role: $("newRole").value,
        }),
      });
      $("addUserForm").reset();
      showToast("تمت إضافة المستخدم", true);
      loadUsers();
    } catch (err) {
      showToast(err.message, false);
    }
  });

  $("myPasswordForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const p1 = $("myNewPassword").value;
    const p2 = $("myNewPassword2").value;
    if (p1 !== p2) {
      showToast("كلمتا المرور غير متطابقتين", false);
      return;
    }
    try {
      await api("/api/users/" + currentUser.id + "/password", {
        method: "POST",
        body: JSON.stringify({ password: p1 }),
      });
      $("myPasswordForm").reset();
      showToast("تم تغيير كلمة المرور", true);
    } catch (err) {
      showToast(err.message, false);
    }
  });

  async function patchUser(id, body) {
    try {
      await api("/api/users/" + id, { method: "PATCH", body: JSON.stringify(body) });
      showToast("تم التحديث", true);
    } catch (err) {
      showToast(err.message, false);
      loadUsers();
    }
  }

  async function deleteUser(id) {
    if (!confirm("حذف هذا المستخدم؟")) return;
    try {
      await api("/api/users/" + id, { method: "DELETE" });
      showToast("تم الحذف", true);
      loadUsers();
    } catch (err) {
      showToast(err.message, false);
    }
  }

  function changeUserPassword(id) {
    const p = prompt("كلمة المرور الجديدة (6 أحرف على الأقل):");
    if (!p) return;
    api("/api/users/" + id + "/password", {
      method: "POST",
      body: JSON.stringify({ password: p }),
    })
      .then(() => showToast("تم تغيير كلمة المرور", true))
      .catch((err) => showToast(err.message, false));
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatDate(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("ar-SA");
  }

  async function bootstrap() {
    if (parsePortalFromUrl()) {
      setToken("");
      setLegacyPass("");
      showScreen("portalWait");
      try {
        await tryPortalLogin();
        await enterApp();
      } catch (err) {
        showScreen("login");
        const intro = $("loginIntro");
        if (intro) {
          intro.innerHTML =
            escapeHtml(err.message) +
            "<br><br><strong>تأكد:</strong><br>1) شغّل <code>start-admin.bat</code> واترك النافذة مفتوحة<br>" +
            "2) استخدم رابط يبدأ بـ <strong>192.168…</strong> من الرئيسية — رابط <strong>169.254</strong> لا يعمل من الجوال<br>" +
            "3) الجوال والكمبيوتر على <strong>نفس شبكة الواي فاي</strong>";
        }
        showToast(err.message, false);
      }
      return;
    }

    if (getToken()) {
      trySession().catch(() => init());
    } else {
      init();
    }
  }

  bootstrap();
})();
