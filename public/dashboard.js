(function () {
  const TOKEN_KEY = "adminToken";
  const LEGACY_KEY = "legacyPass";
  const ROLE_LABELS = { admin: "مدير", editor: "محرر", viewer: "عرض فقط" };

  const PAGE_TITLES = {
    home: "الرئيسية",
    stats: "إحصائية المكالمات",
    leads: "سجل العملاء",
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
    initLeadNoteModal();
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
      `تم فتح المحادثة في واتساب ${res.label || waLabel || waAccountId} — الرد الآلي ما زال يعمل`,
      true
    );
  }

  function bindLeadsChatLinks() {
    const tbody = $("leadsTableBody");
    if (!tbody || tbody.dataset.chatBound) return;
    tbody.dataset.chatBound = "1";
    tbody.addEventListener("click", async (e) => {
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

  function isElectronicLead(row) {
    return appLabel(row) === "إلكتروني";
  }

  function leadShowsOrderNumber(row) {
    if (row.applicationOrderNumber) return true;
    return (
      isElectronicLead(row) ||
      Boolean(row.followUpSentAt) ||
      row.contactDelivery === "electronic_link" ||
      Boolean(row.portalUrl)
    );
  }

  function orderNumberCellHtml(row) {
    const num = row.applicationOrderNumber;
    if (num) {
      const when = row.orderNumberAt
        ? new Date(row.orderNumberAt).toLocaleString("ar-SA")
        : "";
      return (
        `<span class="order-num" title="${escapeHtml(when)}">` +
        `${escapeHtml(num)}</span>`
      );
    }
    if (!leadShowsOrderNumber(row)) return "—";
    if (!can("settings:write")) return "—";
    return (
      `<div class="order-num-edit">` +
      `<input type="text" class="order-num-input" dir="ltr" ` +
      `data-lead-id="${escapeHtml(row.id || "")}" ` +
      `placeholder="101…" pattern="101[0-9]*" title="رقم الطلب يبدأ بـ 101" />` +
      `<button type="button" class="btn-sm btn-primary order-num-save" ` +
      `data-lead-id="${escapeHtml(row.id || "")}">حفظ</button>` +
      `</div>`
    );
  }

  let leadNoteModalLeadId = null;
  const leadsNoteById = new Map();

  function notePreview(text, max = 36) {
    const t = String(text || "").trim();
    if (!t) return "";
    if (t.length <= max) return t;
    return t.slice(0, max) + "…";
  }

  function statusNoteCellHtml(row) {
    const note = row.orderStatusNote;
    const when = row.orderStatusNoteAt
      ? new Date(row.orderStatusNoteAt).toLocaleString("ar-SA")
      : "";
    const canEdit = can("settings:write");
    if (note) {
      const preview = escapeHtml(notePreview(note));
      const btnLabel = canEdit ? "تعديل" : "عرض";
      const btn =
        canEdit || can("stats:read")
          ? `<button type="button" class="btn-sm btn-secondary lead-note-btn" data-lead-id="${escapeHtml(row.id || "")}" data-phone="${escapeHtml(row.phone || "")}">${btnLabel}</button>`
          : "";
      return (
        `<div class="lead-note-cell">` +
        `<span class="lead-note-preview" title="${escapeHtml(when)}">${preview}</span> ` +
        btn +
        `</div>`
      );
    }
    if (!canEdit) return "—";
    return (
      `<button type="button" class="btn-sm btn-primary lead-note-btn" ` +
      `data-lead-id="${escapeHtml(row.id || "")}" data-phone="${escapeHtml(row.phone || "")}">إضافة ملاحظة</button>`
    );
  }

  function closeLeadNoteModal() {
    const modal = $("leadNoteModal");
    if (modal) modal.classList.add("hidden");
    leadNoteModalLeadId = null;
  }

  function openLeadNoteModal(leadId, phone) {
    leadNoteModalLeadId = leadId;
    const note = leadsNoteById.get(leadId) || "";
    const modal = $("leadNoteModal");
    const title = $("leadNoteModalTitle");
    const textEl = $("leadNoteModalText");
    const meta = $("leadNoteModalMeta");
    if (!modal || !textEl) return;
    if (title) title.textContent = "ملاحظة — حالة الطلب";
    const phoneLine = $("leadNoteModalPhone");
    if (phoneLine) phoneLine.textContent = phone ? `العميل: ${phone}` : "";
    textEl.value = note || "";
    if (meta) meta.textContent = can("settings:write") ? "تُحفظ لكل سجلات نفس الجوال على هذا البوت" : "";
    textEl.disabled = !can("settings:write");
    $("leadNoteModalSave")?.classList.toggle("hidden", !can("settings:write"));
    $("leadNoteModalClear")?.classList.toggle("hidden", !can("settings:write"));
    modal.classList.remove("hidden");
    textEl.focus();
  }

  function initLeadNoteModal() {
    if ($("leadNoteModal")?.dataset.bound) return;
    const modal = $("leadNoteModal");
    if (!modal) return;
    modal.dataset.bound = "1";

    $("leadNoteModalClose")?.addEventListener("click", closeLeadNoteModal);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeLeadNoteModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !modal.classList.contains("hidden")) {
        closeLeadNoteModal();
      }
    });

    $("leadNoteModalSave")?.addEventListener("click", async () => {
      const id = leadNoteModalLeadId;
      const text = $("leadNoteModalText")?.value ?? "";
      if (!id) return;
      const btn = $("leadNoteModalSave");
      if (btn) btn.disabled = true;
      try {
        await api("/api/leads/" + encodeURIComponent(id) + "/status-note", {
          method: "PATCH",
          body: JSON.stringify({ note: text }),
        });
        showToast(text.trim() ? "تم حفظ الملاحظة" : "تم مسح الملاحظة", true);
        closeLeadNoteModal();
        await loadLeads();
      } catch (err) {
        showToast(err.message, false);
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    $("leadNoteModalClear")?.addEventListener("click", async () => {
      const id = leadNoteModalLeadId;
      if (!id) return;
      if (!window.confirm("مسح الملاحظة لهذا العميل؟")) return;
      const textEl = $("leadNoteModalText");
      if (textEl) textEl.value = "";
      $("leadNoteModalSave")?.click();
    });
  }

  function bindLeadNoteButtons() {
    document.querySelectorAll(".lead-note-btn").forEach((btn) => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", () => {
        openLeadNoteModal(btn.dataset.leadId, btn.dataset.phone);
      });
    });
  }

  function leadManualMarkHtml(row) {
    const mark = row.manualMark || "";
    const id = row.id || "";
    if (!can("settings:write")) {
      if (mark === "done") {
        return `<span class="lead-mark-dot done" title="منفذ">●</span>`;
      }
      if (mark === "rejected") {
        return `<span class="lead-mark-dot rejected" title="مرفوض">●</span>`;
      }
      if (mark === "waiting") {
        return `<span class="lead-mark-dot waiting" title="انتظار">●</span>`;
      }
      if (mark === "reminder") {
        return `<span class="lead-mark-dot reminder" title="تذكير">●</span>`;
      }
      return `<span class="lead-mark-dot none" aria-hidden="true"></span>`;
    }
    if (!id) return `<span class="lead-mark-dot none"></span>`;
    return (
      `<span class="lead-mark-picker" data-lead-id="${escapeHtml(id)}">` +
      `<button type="button" class="lead-mark-btn none${mark === "" ? " active" : ""}" data-mark="" title="بدون علامة">○</button>` +
      `<button type="button" class="lead-mark-btn waiting${mark === "waiting" ? " active" : ""}" data-mark="waiting" title="انتظار">⏳</button>` +
      `<button type="button" class="lead-mark-btn reminder${mark === "reminder" ? " active" : ""}" data-mark="reminder" title="تذكير">★</button>` +
      `<button type="button" class="lead-mark-btn done${mark === "done" ? " active" : ""}" data-mark="done" title="منفذ">✓</button>` +
      `<button type="button" class="lead-mark-btn rejected${mark === "rejected" ? " active" : ""}" data-mark="rejected" title="مرفوض">✕</button>` +
      `</span>`
    );
  }

  function leadRowClasses(row, searchActive) {
    const mark = row.manualMark || "";
    if (mark === "done") return "row-mark-done";
    if (mark === "rejected") return "row-mark-rejected";
    if (mark === "waiting") return "row-mark-waiting";
    if (mark === "reminder") return "row-mark-reminder";
    if (searchActive) return "row-search-hit";
    return "";
  }

  function leadPhoneCellHtml(row, waId) {
    const markHtml = leadManualMarkHtml(row);
    const link =
      `<a class="phone-link wa-chat-link" href="#" data-phone="${escapeHtml(row.phone)}" data-wa-id="${escapeHtml(waId)}" data-wa-label="${escapeHtml(row.waAccountLabel || "")}" title="فتح المحادثة في واتساب البوت — ${escapeHtml(row.waAccountLabel || "البوت")}">${escapeHtml(row.phone)}</a>`;
    return `<div class="lead-phone-cell">${markHtml}${link}</div>`;
  }

  function bindLeadManualMarkButtons() {
    document.querySelectorAll(".lead-mark-picker").forEach((wrap) => {
      if (wrap.dataset.bound) return;
      wrap.dataset.bound = "1";
      wrap.querySelectorAll(".lead-mark-btn").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const leadId = wrap.dataset.leadId;
          const mark = btn.dataset.mark ?? "";
          if (!leadId) return;
          if (btn.classList.contains("active")) return;
          wrap.querySelectorAll(".lead-mark-btn").forEach((b) => {
            b.disabled = true;
          });
          try {
            await api("/api/leads/" + encodeURIComponent(leadId) + "/manual-mark", {
              method: "PATCH",
              body: JSON.stringify({ mark }),
            });
            const labels = {
              "": "بدون علامة",
              waiting: "انتظار",
              reminder: "تذكير",
              done: "منفذ",
              rejected: "مرفوض",
            };
            showToast(`تم التحديد: ${labels[mark] ?? mark}`, true);
            await loadLeads();
          } catch (err) {
            showToast(err.message, false);
            wrap.querySelectorAll(".lead-mark-btn").forEach((b) => {
              b.disabled = false;
            });
          }
        });
      });
    });
  }

  function leadDeleteCellHtml(row) {
    if (!can("settings:write")) return "—";
    const id = row.id || "";
    if (!id) return "—";
    return (
      `<button type="button" class="btn-sm danger lead-delete-btn" ` +
      `data-lead-id="${escapeHtml(id)}" ` +
      `data-phone="${escapeHtml(row.phone || "")}" title="حذف من السجل">حذف</button>`
    );
  }

  function bindLeadDeleteButtons() {
    document.querySelectorAll(".lead-delete-btn").forEach((btn) => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", async () => {
        const id = btn.dataset.leadId;
        const phone = btn.dataset.phone || "";
        if (
          !window.confirm(
            `حذف العميل ${phone} من السجل؟\nلا يمكن التراجع عن الحذف.`
          )
        ) {
          return;
        }
        btn.disabled = true;
        try {
          await api(
            "/api/leads/" + encodeURIComponent(id) + "/delete",
            { method: "POST" }
          );
          showToast("تم حذف العميل من السجل", true);
          await loadLeads();
        } catch (err) {
          showToast(err.message, false);
        } finally {
          btn.disabled = false;
        }
      });
    });
  }

  function bindOrderNumberInputs() {
    document.querySelectorAll(".order-num-edit").forEach((wrap) => {
      const inp = wrap.querySelector(".order-num-input");
      const btn = wrap.querySelector(".order-num-save");
      if (!inp || inp.dataset.bound) return;
      inp.dataset.bound = "1";

      const save = async () => {
        const id = inp.dataset.leadId || btn?.dataset.leadId;
        const val = inp.value.trim();
        if (!id) return;
        inp.disabled = true;
        if (btn) btn.disabled = true;
        try {
          await api("/api/leads/" + encodeURIComponent(id) + "/order-number", {
            method: "PATCH",
            body: JSON.stringify({ orderNumber: val }),
          });
          showToast(val ? "تم حفظ رقم الطلب" : "تم مسح رقم الطلب", true);
          await loadLeads();
        } catch (err) {
          showToast(err.message, false);
        } finally {
          inp.disabled = false;
          if (btn) btn.disabled = false;
        }
      };

      if (btn) btn.addEventListener("click", save);
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          save();
        }
      });
    });
  }

  function followUpCellHtml(row) {
    if (row.followUpSentAt) {
      const when = new Date(row.followUpSentAt).toLocaleString("ar-SA");
      return (
        `<span class="followup-status sent" title="${escapeHtml(row.followUpMessage || "تم الإرسال")}">` +
        `✓ تم · ${escapeHtml(when)}</span>`
      );
    }

    const q = row.followUpQueue;
    if (q) {
      if (q.status === "pending" || q.status === "processing") {
        return `<span class="followup-status pending" title="بانتظار البوت">⏳ في الطابور</span>`;
      }
      if (q.status === "failed") {
        const err = q.error ? ` — ${q.error}` : "";
        const retry =
          isElectronicLead(row) && can("settings:write")
            ? ` <button type="button" class="btn-sm btn-secondary lead-followup-btn" data-lead-id="${escapeHtml(row.id || "")}" data-phone="${escapeHtml(row.phone)}" data-wa-id="${escapeHtml(row.waAccountId || selectedLeadsWa || "")}">إعادة</button>`
            : "";
        return (
          `<span class="followup-status failed" title="${escapeHtml(q.error || "فشل الإرسال")}">✗ فشل${escapeHtml(err)}</span>${retry}`
        );
      }
    }

    if (!isElectronicLead(row) || !can("settings:write")) return "—";
    const waId = row.waAccountId || selectedLeadsWa || "";
    return (
      `<button type="button" class="btn-sm btn-secondary lead-followup-btn" ` +
      `data-lead-id="${escapeHtml(row.id || "")}" ` +
      `data-phone="${escapeHtml(row.phone)}" ` +
      `data-wa-id="${escapeHtml(waId)}">إرسال</button>`
    );
  }

  async function loadFollowUpTemplate() {
    const el = $("followUpMessage");
    if (!el || !can("settings:read") || el.dataset.loaded) return;
    try {
      const data = await api("/api/leads/followup-template");
      if (data.message) el.value = data.message;
      el.dataset.loaded = "1";
    } catch (_) {}
  }

  async function queueFollowUpMessage({ leadId, confirmText }) {
    const message = $("followUpMessage")?.value.trim();
    if (!message) {
      showToast("اكتب نص الرسالة أولاً", false);
      return;
    }
    const onlyUnsent = $("followUpOnlyUnsent")?.checked !== false;
    const wa = selectedLeadsWa;

    const dry = await api("/api/leads/send-followup", {
      method: "POST",
      body: JSON.stringify({
        message,
        waAccountId: wa || undefined,
        leadId: leadId || undefined,
        onlyUnsent,
        dryRun: true,
      }),
    });

    if (!dry.count) {
      showToast("لا يوجد عملاء إلكترونيون مطابقون للفلتر", false);
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
        onlyUnsent,
        dryRun: false,
      }),
    });

    showToast(
      `تمت إضافة ${res.queued || 0} رسالة للطابور — يرسلها البوت خلال ثوانٍ`,
      true
    );
    await loadLeads();
  }

  function bindLeadFollowUpButtons() {
    document.querySelectorAll(".lead-followup-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await queueFollowUpMessage({
            leadId: btn.dataset.leadId,
            confirmText: `إرسال رسالة متابعة إلى ${btn.dataset.phone}؟`,
          });
        } catch (err) {
          showToast(err.message, false);
        } finally {
          btn.disabled = false;
        }
      });
    });
  }

  function getLeadsPhoneSearch() {
    return String($("leadsPhoneSearch")?.value || "").trim();
  }

  function getLeadsOrderSearch() {
    return String($("leadsOrderSearch")?.value || "").trim();
  }

  function getLeadsMarkFilter() {
    return String($("leadsMarkFilter")?.value || "").trim();
  }

  function filterLeadsByManualMark(leads, markFilter) {
    const list = Array.isArray(leads) ? leads : [];
    if (!markFilter) return list;
    if (markFilter === "none") return list.filter((r) => !r.manualMark);
    return list.filter((r) => r.manualMark === markFilter);
  }

  function updateLeadsSearchClearBtns() {
    const phoneBtn = $("leadsPhoneSearchClear");
    const orderBtn = $("leadsOrderSearchClear");
    if (phoneBtn) phoneBtn.classList.toggle("hidden", !getLeadsPhoneSearch());
    if (orderBtn) orderBtn.classList.toggle("hidden", !getLeadsOrderSearch());
  }

  async function loadLeads() {
    if (!can("stats:read")) return;
    await loadFollowUpTemplate();
    await syncWaLeadTabsFromApi();
    const tbody = $("leadsTableBody");
    const filter = $("leadsFilter")?.value || "";
    const appFilter = $("leadsAppFilter")?.value || "";
    const markFilter = getLeadsMarkFilter();
    const phoneSearch = getLeadsPhoneSearch();
    const orderSearch = getLeadsOrderSearch();
    const wa = selectedLeadsWa;
    initLeadsWaSelect();
    updateLeadsSearchClearBtns();
    tbody.innerHTML = "<tr><td colspan='14'>جاري التحميل…</td></tr>";

    const phoneDigits = phoneSearch.replace(/\D/g, "");
    const orderDigits = orderSearch.replace(/\D/g, "");
    if (phoneSearch && phoneDigits.length > 0 && phoneDigits.length < 3) {
      tbody.innerHTML =
        "<tr><td colspan='14'>أدخل 3 أرقام على الأقل لبحث الجوال (مثال: 2285 أو 0555162285)</td></tr>";
      return;
    }
    if (orderSearch && orderDigits.length > 0 && orderDigits.length < 3) {
      tbody.innerHTML =
        "<tr><td colspan='14'>أدخل 3 أرقام على الأقل لبحث الطلب (مثال: 101 أو 10123456789)</td></tr>";
      return;
    }

    try {
      const searchActive = phoneDigits.length >= 3 || orderDigits.length >= 3;
      const markFilterActive = Boolean(markFilter);
      const params = new URLSearchParams({
        limit: searchActive || markFilterActive ? "500" : "200",
      });
      if (filter) params.set("status", filter);
      if (appFilter) params.set("applicationMethod", appFilter);
      if (markFilter) params.set("manualMark", markFilter);
      if (wa) params.set("waAccountId", wa);
      if (phoneDigits.length >= 3) params.set("phoneSearch", phoneSearch);
      if (orderDigits.length >= 3) params.set("orderNumberSearch", orderSearch);
      const data = await api("/api/leads?" + params.toString());
      const leads = filterLeadsByManualMark(data.leads || [], markFilter);
      const c = data.counts || {};
      const ac = data.applicationCounts || {};
      const mc = data.manualMarkCounts || {};
      const waLabel = wa
        ? WA_LEADS_TABS.find((a) => a.waAccountId === wa)?.label || wa
        : "الكل";
      let countsText = "";
      if (data.phoneSearch || data.orderNumberSearch) {
        const parts = [];
        if (data.phoneSearch) parts.push(`جوال «${data.phoneSearch}»`);
        if (data.orderNumberSearch) parts.push(`طلب «${data.orderNumberSearch}»`);
        countsText = `نتائج البحث (${parts.join(" + ")}): ${data.total || 0} سجل`;
        if (!wa) countsText += " — (تبويب الكل)";
      } else {
        countsText =
          `${waLabel} — تمويل شخصي: ${c.personal_finance || 0} · عرض بديل: ${c.combo_offer || 0} · مرفوض: ${c.rejected || 0} · عقاري: ${c.property || 0} · إيقاف خدمات: ${c.service_stop || 0} · أخرى: ${c.qualified || 0}`;
        countsText += ` · إلكتروني: ${ac.electronic || 0} · فرع: ${ac.branch || 0} · باقة: ${ac.combo || 0}`;
        countsText += ` · ⏳ ${mc.waiting || 0} · ★ ${mc.reminder || 0} · ✓ ${mc.done || 0} · ✕ ${mc.rejected || 0}`;
        if (markFilter) {
          const markLabels = {
            waiting: "انتظار (برتقالي)",
            reminder: "تذكير (بنفسجي)",
            done: "منفذ (أخضر)",
            rejected: "مرفوض (أحمر)",
            none: "بدون علامة",
          };
          countsText = `عرض ${leads.length} عميل فقط — علامة: ${markLabels[markFilter] || markFilter}`;
        }
      }
      const summaryEl = $("leadsSummary");
      if (summaryEl) {
        summaryEl.textContent = countsText;
        summaryEl.classList.toggle("hidden", !countsText);
      }

      const fq = data.followUpQueue || {};
      const statusEl = $("leadsFollowUpStatus");
      if (statusEl && can("settings:write")) {
        if (fq.waiting || fq.sent || fq.failed) {
          statusEl.classList.remove("hidden");
          statusEl.innerHTML =
            `<strong>حالة المتابعة:</strong> ` +
            `⏳ ${fq.waiting || 0} في الطابور · ` +
            `✓ ${fq.sent || 0} أُرسلت · ` +
            `✗ ${fq.failed || 0} فشل · ` +
            `<span class="muted">حدّث الجدول بعد دقيقة لمتابعة الإرسال</span>`;
        } else {
          statusEl.classList.add("hidden");
          statusEl.textContent = "";
        }
      }

      leadsNoteById.clear();
      for (const row of leads) {
        if (row.id) leadsNoteById.set(row.id, row.orderStatusNote || "");
      }

      const markBar = $("leadsMarkFilter")?.closest(".filter-bar");
      if (markBar) markBar.classList.toggle("mark-filter-active", markFilterActive);

      if (!leads.length) {
        let emptyMsg = wa
          ? "لا توجد سجلات لهذا الجوال بعد — العملاء الجدد يُسجّلون تلقائياً عند التأهيل/الرفض على نافذة البوت نفسها"
          : "لا توجد سجلات — أكمل محادثات على البوت";
        if (data.phoneSearch || data.orderNumberSearch) {
          if (data.orderNumberSearch && data.phoneSearch) {
            emptyMsg = `لا يوجد سجل يطابق الجوال «${data.phoneSearch}» ورقم الطلب «${data.orderNumberSearch}»`;
          } else if (data.orderNumberSearch) {
            emptyMsg = wa
              ? `لا يوجد رقم طلب «${data.orderNumberSearch}» في سجل ${waLabel} — جرّب تبويب «الكل»`
              : `لا يوجد رقم طلب «${data.orderNumberSearch}» في السجل`;
          } else {
            emptyMsg = wa
              ? `لا يوجد عميل برقم «${data.phoneSearch}» في سجل ${waLabel} — جرّب تبويب «الكل»`
              : `لا يوجد عميل برقم «${data.phoneSearch}» في السجل`;
          }
        } else if (markFilter) {
          const markLabels = {
            waiting: "انتظار (برتقالي)",
            reminder: "تذكير (بنفسجي)",
            done: "منفذ (أخضر)",
            rejected: "مرفوض (أحمر)",
            none: "بدون علامة",
          };
          emptyMsg = `لا يوجد عميل بعلامة «${markLabels[markFilter] || markFilter}» ضمن الفلاتر الحالية`;
        }
        tbody.innerHTML = `<tr><td colspan='14'>${escapeHtml(emptyMsg)}</td></tr>`;
        return;
      }

      tbody.innerHTML = leads
        .map((row) => {
          const when = row.at ? new Date(row.at).toLocaleString("ar-SA") : "—";
          const waId = row.waAccountId || selectedLeadsWa || "";
          const st = row.status || "qualified";
          return (
            `<tr class="${leadRowClasses(row, searchActive)}">` +
            `<td>${leadPhoneCellHtml(row, waId)}</td>` +
            `<td>${escapeHtml(row.waAccountLabel || row.waAccountId || "—")}</td>` +
            `<td><span class="badge-status ${st}">${escapeHtml(row.statusLabel || st)}</span></td>` +
            `<td>${escapeHtml(when)}</td>` +
            `<td>${escapeHtml(row.inquiryType || "—")}</td>` +
            `<td>${escapeHtml(row.sector || "—")}</td>` +
            `<td>${escapeHtml(row.realEstate || (row.comboPackage ? "باقة عقارية" : "—"))}</td>` +
            `<td>${escapeHtml(formatAmount(row.amount))}</td>` +
            `<td>${escapeHtml(appLabel(row))}</td>` +
            `<td>${orderNumberCellHtml(row)}</td>` +
            `<td>${statusNoteCellHtml(row)}</td>` +
            `<td>${followUpCellHtml(row)}</td>` +
            `<td>${escapeHtml(contactLabel(row))}</td>` +
            `<td>${leadDeleteCellHtml(row)}</td>` +
            "</tr>"
          );
        })
        .join("");
      bindLeadsChatLinks();
      bindLeadManualMarkButtons();
      bindLeadFollowUpButtons();
      bindOrderNumberInputs();
      bindLeadNoteButtons();
      bindLeadDeleteButtons();
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="14">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  $("leadsFilter")?.addEventListener("change", loadLeads);
  $("leadsAppFilter")?.addEventListener("change", loadLeads);
  $("leadsMarkFilter")?.addEventListener("change", loadLeads);
  $("refreshLeadsBtn")?.addEventListener("click", loadLeads);
  $("leadsSearchBtn")?.addEventListener("click", loadLeads);
  $("leadsPhoneSearchClear")?.addEventListener("click", () => {
    const input = $("leadsPhoneSearch");
    if (input) input.value = "";
    updateLeadsSearchClearBtns();
    loadLeads();
  });
  $("leadsOrderSearchClear")?.addEventListener("click", () => {
    const input = $("leadsOrderSearch");
    if (input) input.value = "";
    updateLeadsSearchClearBtns();
    loadLeads();
  });
  for (const id of ["leadsPhoneSearch", "leadsOrderSearch"]) {
    $(id)?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        loadLeads();
      }
    });
  }
  $("sendFollowUpBtn")?.addEventListener("click", async () => {
    const btn = $("sendFollowUpBtn");
    btn.disabled = true;
    try {
      await queueFollowUpMessage({});
    } catch (err) {
      showToast(err.message, false);
    } finally {
      btn.disabled = false;
    }
  });

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
      .replace(/>/g, "&gt;");
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
