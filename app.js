const STORAGE_KEY = "last_bill";
const HISTORY_KEY = "rentcount_history_v1";
const HISTORY_LIMIT = 50;

const state = {
  period: "",
  totalKwh: "",
  billAmount: "",
  roomCount: 5,
  labelMode: "alpha",
  rooms: [],
  sharedMode: "auto",
  sharedKwhManual: "",
  allocation: "proportional",
  includeSharedNote: false,
  exportIncludeDate: true,
  exportIncludeUrl: false,
  showAvg4: false
};

const $ = (id) => document.getElementById(id);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const allocationLabels = {
  landlord: "房東吸收",
  equal: "平均分攤",
  proportional: "按用電比例分攤"
};

function init() {
  populatePeriods();
  ensureRooms();
  bindEvents();
  loadFromStorage(false);
  applyStateToInputs();
  refreshAll();
  updateLoadBtn();
  renderHistory();
}

document.addEventListener("DOMContentLoaded", init);

function populatePeriods() {
  const select = $("periodSelect");
  const now = new Date();
  for (let i = 0; i < 36; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const label = `${y}/${m}`;
    const opt = document.createElement("option");
    opt.value = label;
    opt.textContent = label;
    select.appendChild(opt);
  }
}

function bindEvents() {
  $("homeBtn").addEventListener("click", () => setStep(0));
  $("startBtn").addEventListener("click", () => setStep(1));
  $("loadBtn").addEventListener("click", () => loadFromStorage(true));
  $("toStep2").addEventListener("click", () => validateStep1() && setStep(2));
  $("toStep3").addEventListener("click", () => validateStep2() && setStep(3));
  $("toStep4").addEventListener("click", () => {
    if (!validateStep3()) return;
    saveHistoryEntry();
    setStep(4);
  });
  $("backTo1").addEventListener("click", () => setStep(1));
  $("backTo2").addEventListener("click", () => setStep(2));
  $("backTo3").addEventListener("click", () => setStep(3));

  $("periodSelect").addEventListener("change", (e) => { state.period = e.target.value; persist(); refreshAll(); });
  $("totalKwh").addEventListener("input", (e) => { state.totalKwh = e.target.value; persist(); refreshAll(); });
  $("billAmount").addEventListener("input", (e) => { state.billAmount = e.target.value; persist(); refreshAll(); });

  $("toggleAvg").addEventListener("click", () => { state.showAvg4 = !state.showAvg4; persist(); refreshAll(); });

  $("roomPlus").addEventListener("click", () => { if (state.roomCount < 20) { state.roomCount += 1; ensureRooms(); renderRooms(); persist(); refreshAll(); } });
  $("roomMinus").addEventListener("click", () => { if (state.roomCount > 1) { state.roomCount -= 1; ensureRooms(); renderRooms(); persist(); refreshAll(); } });

  $$(".label-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      state.labelMode = chip.dataset.label;
      if (state.labelMode === "custom") {
        state.rooms.forEach((room, idx) => {
          if (!room.label || String(room.label).trim() === "") {
            room.label = autoLabel(idx);
          }
        });
      }
      renderRooms();
      persist();
      refreshAll();
    });
  });

  $("manualSharedToggle").addEventListener("change", (e) => { state.sharedMode = e.target.checked ? "manual" : "auto"; persist(); refreshAll(); });
  $("sharedKwh").addEventListener("input", (e) => { state.sharedKwhManual = e.target.value; persist(); refreshAll(); });

  $$("[data-method]").forEach((chip) => {
    chip.addEventListener("click", () => { state.allocation = chip.dataset.method; persist(); refreshAll(); });
  });

  $("copyTextBtn").addEventListener("click", copyTextReport);
  $("exportImgBtn").addEventListener("click", exportImage);

  $("moreBtn").addEventListener("click", () => $("modalBackdrop").classList.add("active"));
  $("closeModal").addEventListener("click", () => $("modalBackdrop").classList.remove("active"));

  $("includeSharedNote").addEventListener("change", (e) => { state.includeSharedNote = e.target.checked; persist(); });
  $("exportIncludeDate").addEventListener("change", (e) => { state.exportIncludeDate = e.target.checked; persist(); });
  $("exportIncludeUrl").addEventListener("change", (e) => { state.exportIncludeUrl = e.target.checked; persist(); });

  $("clearDataBtn").addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    resetState();
    updateLoadBtn();
    $("modalBackdrop").classList.remove("active");
    showToast("已清除資料");
  });

  $("clearHistoryBtn").addEventListener("click", () => {
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
    showToast("已清除歷史紀錄");
  });

  $("historyList").addEventListener("click", (event) => {
    const deleteBtn = event.target.closest("[data-history-delete]");
    if (deleteBtn) {
      deleteHistory(deleteBtn.dataset.historyDelete);
      return;
    }
    const copyBtn = event.target.closest("[data-history-copy]");
    if (copyBtn) {
      copyHistory(copyBtn.dataset.historyCopy);
    }
  });

  $("copyFeedbackBtn").addEventListener("click", copyFeedback);
  $("clearFeedbackBtn").addEventListener("click", () => {
    $("feedbackText").value = "";
    showToast("已清空回饋");
  });
}

function setStep(step) {
  $$(".step").forEach((section) => section.classList.remove("active"));
  $("step" + step).classList.add("active");
  $$(".dot").forEach((dot) => dot.classList.toggle("active", Number(dot.dataset.step) === step));
  $("progressFill").style.width = `${(step / 4) * 100}%`;
}

function num(raw) {
  const val = Number(raw);
  return Number.isFinite(val) ? val : 0;
}

function formatMoney(value, decimals = 2) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "--";
  return amount.toLocaleString("zh-TW", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function validNonNeg(raw) {
  if (raw === "" || raw === null || raw === undefined) return false;
  const val = Number(raw);
  return Number.isFinite(val) && val >= 0;
}

function sumRoomKwh() {
  return state.rooms.reduce((sum, room) => sum + num(room.kwh), 0);
}

function autoLabel(idx) {
  return state.labelMode === "numeric" ? String(idx + 1) : String.fromCharCode(65 + idx);
}

function displayLabel(label, idx) {
  if (state.labelMode === "custom") {
    const trimmed = (label ?? "").toString().trim();
    return trimmed ? trimmed : `房間${idx + 1}`;
  }
  return autoLabel(idx);
}

function formatRoomLabel(label, idx) {
  const base = displayLabel(label, idx);
  return state.labelMode === "custom" ? base : `${base}房`;
}

function ensureRooms() {
  while (state.rooms.length < state.roomCount) state.rooms.push({ label: "", kwh: "" });
  if (state.rooms.length > state.roomCount) state.rooms = state.rooms.slice(0, state.roomCount);
  if (state.labelMode === "custom") {
    state.rooms.forEach((room, idx) => {
      if (!room.label || String(room.label).trim() === "") {
        room.label = autoLabel(idx);
      }
    });
  }
}

function renderRooms() {
  $("roomCount").textContent = state.roomCount;
  const container = $("roomsContainer");
  container.innerHTML = "";
  state.rooms.forEach((room, idx) => {
    const card = document.createElement("div");
    const headerLabel = formatRoomLabel(room.label, idx);
    const customField = state.labelMode === "custom"
      ? `
        <div class="field">
          <span>房號 / 姓名</span>
          <input type="text" data-label-index="${idx}" value="${room.label}" placeholder="例如：小王">
        </div>
      `
      : "";

    card.className = "card room-card";
    card.innerHTML = `
      <div class="room-header">
        <div class="room-label">${headerLabel}</div>
        <div class="field-note">#${idx + 1}</div>
      </div>
      ${customField}
      <div class="field">
        <span>房間分表度數</span>
        <input type="number" inputmode="numeric" min="0" step="1" data-index="${idx}" value="${room.kwh}">
        <div class="field-note">度</div>
      </div>
    `;
    container.appendChild(card);
  });

  container.querySelectorAll("input[data-index]").forEach((input) => {
    input.addEventListener("input", (e) => {
      const idx = Number(e.target.dataset.index);
      state.rooms[idx].kwh = e.target.value;
      persist();
      refreshAll();
    });
  });

  container.querySelectorAll("input[data-label-index]").forEach((input) => {
    input.addEventListener("input", (e) => {
      const idx = Number(e.target.dataset.labelIndex);
      state.rooms[idx].label = e.target.value;
      persist();
      refreshAll();
    });
  });
}

function refreshAll() {
  updateAvg();
  updateStep1Validation(false);
  updateStep2Summary();
  updateStep3Shared();
  updateAllocationUI();
  updateStep3Validation(false);
  updateResults();
  updateLabelButtons();
  $("manualSharedField").classList.toggle("hidden", state.sharedMode !== "manual");
  $("toggleAvg").textContent = state.showAvg4 ? "顯示 2 位" : "顯示 4 位";
}

function updateLabelButtons() {
  $$(".label-chip").forEach((chip) => chip.classList.toggle("active", chip.dataset.label === state.labelMode));
}

function updateAvg() {
  const total = num(state.totalKwh);
  const bill = num(state.billAmount);
  const avg = total > 0 ? bill / total : 0;
  $("avgPrice").textContent = total > 0 && bill > 0 ? avg.toFixed(2) : "--";
  $("avgPriceDetail").textContent = state.showAvg4 && avg > 0 ? `精確值：${avg.toFixed(4)} 元/度` : "";
}

function updateStep1Validation(showError) {
  const totalValid = num(state.totalKwh) > 0;
  const billValid = num(state.billAmount) > 0;
  const errorBox = $("step1Error");
  if (!totalValid || !billValid) {
    if (showError) {
      errorBox.textContent = "請輸入正確的台電總度數與總金額。";
      errorBox.classList.remove("hidden");
    } else {
      errorBox.classList.add("hidden");
    }
    return false;
  }
  errorBox.classList.add("hidden");
  return true;
}

function validateStep1() { return updateStep1Validation(true); }

function updateStep2Summary() {
  const sum = sumRoomKwh();
  const total = num(state.totalKwh);
  $("sumRoomKwh").textContent = sum.toLocaleString("zh-TW");
  const delta = total - sum;
  $("deltaKwh").textContent = `${delta >= 0 ? "+" : ""}${delta.toLocaleString("zh-TW")}`;

  const warning = $("step2Warning");
  if (total > 0 && sum > total) {
    warning.textContent = "房間加總超過台電總度數，請確認輸入或改用手動公共度數。";
    warning.classList.remove("hidden");
  } else if (total > 0 && sum < total) {
    warning.textContent = "差額將視為公共用電（可下一步調整）。";
    warning.classList.remove("hidden");
  } else {
    warning.classList.add("hidden");
  }

  const blocker = $("step2Blocker");
  if (total > 0 && sum > total) {
    blocker.classList.remove("hidden");
    $("toStep3").disabled = true;
  } else {
    blocker.classList.add("hidden");
    $("toStep3").disabled = false;
  }
}

function updateStep2Validation(showError) {
  const errorBox = $("step2Error");
  const invalidRoom = state.rooms.some((room) => !validNonNeg(room.kwh));
  const total = num(state.totalKwh);
  const sum = sumRoomKwh();
  const exceed = total > 0 && sum > total;
  if (invalidRoom) {
    if (showError) {
      errorBox.textContent = "請確認每間房的度數皆為 0 或正整數。";
      errorBox.classList.remove("hidden");
    } else {
      errorBox.classList.add("hidden");
    }
    return false;
  }
  if (exceed) {
    if (showError) {
      $("step2Blocker").classList.remove("hidden");
    }
    errorBox.classList.add("hidden");
    return false;
  }
  errorBox.classList.add("hidden");
  return true;
}

function validateStep2() {
  if (!updateStep1Validation(true)) return false;
  return updateStep2Validation(true);
}

function updateStep3Shared() {
  const total = num(state.totalKwh);
  const sum = sumRoomKwh();
  const autoShared = total - sum;
  $("autoSharedKwh").textContent = autoShared.toLocaleString("zh-TW");

  let sharedKwh = state.sharedMode === "manual" ? num(state.sharedKwhManual) : autoShared;
  const sharedCheck = $("sharedCheck");
  if (state.sharedMode === "manual") {
    const valid = validNonNeg(state.sharedKwhManual);
    sharedCheck.textContent = valid ? `房間 + 公共：${(sum + sharedKwh).toLocaleString("zh-TW")} 度` : "請輸入公共用電度數";
  } else {
    sharedCheck.textContent = `房間 + 公共：${(sum + sharedKwh).toLocaleString("zh-TW")} 度`;
  }

  const mismatch = total > 0 && Math.abs(sum + sharedKwh - total) > 0.001;
  const warning = $("sharedWarning");
  if (mismatch) {
    warning.textContent = "加總不等於台電總度數，最後加總可能不等於帳單。";
    warning.classList.remove("hidden");
  } else {
    warning.classList.add("hidden");
  }
}

function updateAllocationUI() {
  $$("[data-method]").forEach((chip) => chip.classList.toggle("active", chip.dataset.method === state.allocation));
}

function updateStep3Validation(showError) {
  const errorBox = $("allocationError");
  const invalidShared = state.sharedMode === "manual" && !validNonNeg(state.sharedKwhManual);
  const sum = sumRoomKwh();
  const proportionalInvalid = state.allocation === "proportional" && sum <= 0;

  if (invalidShared || proportionalInvalid) {
    if (showError) {
      errorBox.textContent = invalidShared
        ? "手動公共用電度數需為 0 或正整數。"
        : "房間度數加總為 0，無法使用按用電比例分攤。";
      errorBox.classList.remove("hidden");
    } else {
      errorBox.classList.add("hidden");
    }
    return false;
  }
  errorBox.classList.add("hidden");
  return true;
}

function validateStep3() {
  if (!updateStep2Validation(true)) return false;
  return updateStep3Validation(true);
}

function computeResults() {
  const total = num(state.totalKwh);
  const bill = num(state.billAmount);
  const sumRoom = sumRoomKwh();
  const avg = total > 0 ? bill / total : 0;
  const sharedKwh = state.sharedMode === "manual" ? num(state.sharedKwhManual) : total - sumRoom;
  const sharedCost = sharedKwh * avg;
  const usageTotal = sumRoom + sharedKwh;
  const usageMismatch = total > 0 && Math.abs(usageTotal - total) > 0.001;

  const rooms = state.rooms.map((room) => ({ label: room.label, kwh: num(room.kwh) }));

  const rawCosts = [];
  const roomDetails = [];
  rooms.forEach((room) => {
    const baseCost = room.kwh * avg;
    let sharedCostShare = 0;
    let sharedKwhShare = 0;
    if (state.allocation === "equal") {
      sharedCostShare = rooms.length > 0 ? sharedCost / rooms.length : 0;
      sharedKwhShare = rooms.length > 0 ? sharedKwh / rooms.length : 0;
    } else if (state.allocation === "proportional") {
      if (sumRoom > 0) {
        sharedCostShare = sharedCost * (room.kwh / sumRoom);
        sharedKwhShare = sharedKwh * (room.kwh / sumRoom);
      }
    }
    const rawCost = baseCost + (state.allocation === "landlord" ? 0 : sharedCostShare);
    rawCosts.push(rawCost);
    roomDetails.push({
      label: room.label,
      kwh: room.kwh,
      baseCost,
      sharedCostShare,
      sharedKwhShare,
      rawCost
    });
  });

  const sumFinal = rawCosts.reduce((sum, val) => sum + val, 0);
  return { avg, sumRoom, sharedKwh, sharedCost, usageMismatch, roomDetails, sumFinal, bill };
}

function updateResults() {
  const totalValid = num(state.totalKwh) > 0;
  const billValid = num(state.billAmount) > 0;
  const roomsValid = state.rooms.every((room) => validNonNeg(room.kwh));
  const sharedValid = state.sharedMode !== "manual" || validNonNeg(state.sharedKwhManual);
  const proportionalValid = !(state.allocation === "proportional" && sumRoomKwh() <= 0);

  if (!totalValid || !billValid || !roomsValid || !sharedValid || !proportionalValid) {
    $("roomResults").innerHTML = "<div class=\"notice warn\">請先完成 Step 1～3 的輸入，再查看結果。</div>";
    $("summaryPeriod").textContent = state.period || "--";
    $("summaryTotalKwh").textContent = num(state.totalKwh).toLocaleString("zh-TW");
    $("summaryBillAmount").textContent = num(state.billAmount).toLocaleString("zh-TW");
    $("summaryAvg").textContent = "--";
    $("summarySharedKwh").textContent = "--";
    $("summaryAllocation").textContent = "--";
    $("validationBox").className = "notice warn";
    $("validationBox").textContent = "";
    $("resultNote").textContent = "";
    return;
  }

  const results = computeResults();
  $("summaryPeriod").textContent = state.period || "--";
  $("summaryTotalKwh").textContent = num(state.totalKwh).toLocaleString("zh-TW");
  $("summaryBillAmount").textContent = results.bill.toLocaleString("zh-TW");
  $("summaryAvg").textContent = results.avg.toFixed(2);
  $("summarySharedKwh").textContent = results.sharedKwh.toLocaleString("zh-TW");
  $("summaryAllocation").textContent = allocationLabels[state.allocation] || "--";

  const diffToBill = results.sumFinal - results.bill;
  const validationBox = $("validationBox");

  if (state.allocation === "landlord") {
    const diff = results.bill - results.sumFinal;
    validationBox.className = "notice warn";
    validationBox.textContent = `房東吸收公共費：房客合計 ${formatMoney(results.sumFinal)} 元，較帳單少 ${formatMoney(diff)} 元。`;
  } else if (results.usageMismatch || Math.abs(diffToBill) > 2) {
    validationBox.className = "notice error";
    validationBox.textContent = `房間應付加總 ${formatMoney(results.sumFinal)} 元，與帳單差 ${formatMoney(diffToBill)} 元。輸入可能不一致，請回到 Step 2/3 檢查。`;
  } else {
    validationBox.className = "notice ok";
    validationBox.textContent = `房間應付加總 ${formatMoney(results.sumFinal)} 元，與帳單一致。`;
  }

  $("resultNote").textContent = "金額顯示至小數點 2 位，進位方式由使用者自行決定。";

  const roomResults = $("roomResults");
  roomResults.innerHTML = "";
  results.roomDetails.forEach((room, idx) => {
    const item = document.createElement("div");
    const labelText = formatRoomLabel(room.label, idx);
    const sharedText = state.allocation === "landlord"
      ? "0"
      : `${room.sharedKwhShare.toFixed(1)} 度 / ${formatMoney(room.sharedCostShare)} 元`;
    item.className = "card room-result";
    item.innerHTML = `
      <div class="headline">
        <div><strong>${labelText}</strong>・用電 ${Number(room.kwh).toLocaleString("zh-TW")} 度</div>
        <div class="amount">${formatMoney(room.rawCost)} 元</div>
      </div>
      <div class="field-note">公共分攤：${sharedText}</div>
      <details>
        <summary class="details-toggle">展開明細</summary>
        <div class="field-note">房間電費：${formatMoney(room.baseCost)} 元</div>
        <div class="field-note">公共分攤費：${formatMoney(room.sharedCostShare)} 元</div>
        <div class="field-note">平均電價：${results.avg.toFixed(4)} 元/度</div>
      </details>
    `;
    roomResults.appendChild(item);
  });

  updateExportMeta();
}

function updateExportMeta() {
  const meta = $("exportMeta");
  const lines = [];
  if (state.exportIncludeDate) {
    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    lines.push(`生成日期：${stamp}`);
  }
  if (state.exportIncludeUrl) lines.push(`來源：${location.href}`);
  meta.textContent = lines.join(" | ");
}

async function copyTextReport() {
  const text = buildTextReport();
  try {
    await navigator.clipboard.writeText(text);
    showToast("已複製到剪貼簿");
  } catch (err) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
    showToast("已複製到剪貼簿");
  }
}

function buildTextReport() {
  const results = computeResults();
  const period = state.period ? state.period : "";
  const title = period ? `【本期電費明細】${period}` : "【本期電費明細】";

  const lines = [
    title,
    `台電總度數：${num(state.totalKwh).toLocaleString("zh-TW")} 度`,
    `台電金額：${results.bill.toLocaleString("zh-TW")} 元`,
    `平均每度：${results.avg.toFixed(2)} 元/度`,
    `公共用電：${results.sharedKwh.toLocaleString("zh-TW")} 度（${allocationLabels[state.allocation]}）`,
    ""
  ];

  results.roomDetails.forEach((room, idx) => {
    const labelText = formatRoomLabel(room.label, idx);
    const base = `${labelText}：用電${Number(room.kwh).toLocaleString("zh-TW")}度，應付 ${formatMoney(room.rawCost)} 元`;
    if (state.includeSharedNote && state.allocation !== "landlord") {
      const note = `（含公共分攤 ${formatMoney(room.sharedCostShare)} 元）`;
      lines.push(base + note);
    } else {
      lines.push(base);
    }
  });

  lines.push("");
  if (state.allocation === "landlord") {
    const diff = results.bill - results.sumFinal;
    lines.push(`合計：${formatMoney(results.sumFinal)} 元（房東吸收公共費 ${formatMoney(diff)} 元）`);
  } else {
    const diff = results.sumFinal - results.bill;
    const diffText = diff === 0 ? "與帳單一致" : `與帳單差 ${formatMoney(diff)} 元`;
    lines.push(`合計：${formatMoney(results.sumFinal)} 元（${diffText}）`);
  }

  return lines.join("\n");
}

async function exportImage() {
  if (typeof html2canvas !== "function") {
    showToast("匯出模組載入中");
    return;
  }
  const exportArea = $("resultContent");
  exportArea.classList.add("exporting");
  updateExportMeta();
  try {
    const canvas = await html2canvas(exportArea, { scale: 2, backgroundColor: "#ffffff" });
    const link = document.createElement("a");
    const period = state.period || "rentcount";
    link.download = `rentcount_${period.replace("/", "-")}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    showToast("圖片已匯出");
  } catch (err) {
    console.error(err);
    showToast("匯出失敗，請稍後再試");
  } finally {
    exportArea.classList.remove("exporting");
  }
}

function persist() {
  const payload = {
    period: state.period,
    total_kwh: state.totalKwh,
    bill_amount: state.billAmount,
    rooms: state.rooms.map((room) => ({ label: room.label, room_kwh: room.kwh })),
    shared_kwh_mode: state.sharedMode,
    shared_kwh: state.sharedKwhManual,
    allocation_method: state.allocation,
    include_shared_note: state.includeSharedNote,
    export_include_date: state.exportIncludeDate,
    export_include_url: state.exportIncludeUrl,
    label_mode: state.labelMode,
    room_count: state.roomCount,
    updated_at: new Date().toISOString()
  };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)); } catch (err) {}
  updateLoadBtn();
}

function loadFromStorage(moveToStep1) {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    state.period = data.period || "";
    state.totalKwh = data.total_kwh ?? "";
    state.billAmount = data.bill_amount ?? "";
    state.labelMode = data.label_mode || "alpha";
    state.roomCount = data.room_count || (data.rooms ? data.rooms.length : 5);
    state.rooms = (data.rooms || []).map((room) => ({ label: room.label || "", kwh: room.room_kwh ?? "" }));
    state.sharedMode = data.shared_kwh_mode || "auto";
    state.sharedKwhManual = data.shared_kwh ?? "";
    state.allocation = data.allocation_method || "proportional";
    state.includeSharedNote = !!data.include_shared_note;
    state.exportIncludeDate = data.export_include_date ?? true;
    state.exportIncludeUrl = data.export_include_url ?? false;
    ensureRooms();
    applyStateToInputs();
    refreshAll();
    showToast("已載入上次資料");
    if (moveToStep1) setStep(1);
  } catch (err) {}
}

function updateLoadBtn() {
  const hasData = !!localStorage.getItem(STORAGE_KEY);
  $("loadBtn").classList.toggle("hidden", !hasData);
}

function getHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (err) {
    return [];
  }
}

function setHistory(list) {
  const trimmed = list.slice(0, HISTORY_LIMIT);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
  } catch (err) {}
}

function buildHistorySignature(entry) {
  return JSON.stringify({
    period: entry.period,
    total_kwh: entry.total_kwh,
    bill_amount: entry.bill_amount,
    rooms: entry.rooms,
    shared_kwh_mode: entry.shared_kwh_mode,
    shared_kwh: entry.shared_kwh,
    allocation_method: entry.allocation_method,
    label_mode: entry.label_mode
  });
}

function saveHistoryEntry() {
  const totalValid = num(state.totalKwh) > 0;
  const billValid = num(state.billAmount) > 0;
  const roomsValid = state.rooms.every((room) => validNonNeg(room.kwh));
  const sharedValid = state.sharedMode !== "manual" || validNonNeg(state.sharedKwhManual);
  const proportionalValid = !(state.allocation === "proportional" && sumRoomKwh() <= 0);
  if (!totalValid || !billValid || !roomsValid || !sharedValid || !proportionalValid) return;

  const results = computeResults();
  const entry = {
    id: `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    created_at: new Date().toISOString(),
    period: state.period,
    total_kwh: num(state.totalKwh),
    bill_amount: results.bill,
    room_count: state.roomCount,
    label_mode: state.labelMode,
    allocation_method: state.allocation,
    shared_kwh_mode: state.sharedMode,
    shared_kwh: state.sharedMode === "manual" ? num(state.sharedKwhManual) : null,
    rooms: state.rooms.map((room, idx) => ({
      label: displayLabel(room.label, idx),
      room_kwh: num(room.kwh)
    })),
    text_report: buildTextReport()
  };
  entry.signature = buildHistorySignature(entry);

  const history = getHistory();
  if (history[0] && history[0].signature === entry.signature) return;
  history.unshift(entry);
  setHistory(history);
  renderHistory();
}

function renderHistory() {
  const history = getHistory();
  const list = $("historyList");
  const empty = $("historyEmpty");
  if (!list || !empty) return;

  list.innerHTML = "";
  if (history.length === 0) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  history.forEach((item) => {
    const periodLabel = item.period ? item.period : "未填帳期";
    const allocation = allocationLabels[item.allocation_method] || "未指定";
    const title = `${periodLabel} · ${item.bill_amount.toLocaleString("zh-TW")} 元 · ${item.room_count} 房 · ${allocation}`;
    const created = formatDateTime(item.created_at);
    const safeReport = escapeHtml(item.text_report || "");

    const card = document.createElement("div");
    card.className = "history-item";
    card.innerHTML = `
      <div class="history-header">
        <div class="history-title">${title}</div>
        <button class="btn ghost small" data-history-delete="${item.id}" type="button">刪除</button>
      </div>
      <div class="history-meta">建立時間：${created}</div>
      <details>
        <summary class="details-toggle">查看完整明細</summary>
        <pre class="history-text">${safeReport}</pre>
      </details>
      <div class="actions">
        <button class="btn ghost small" data-history-copy="${item.id}" type="button">複製明細</button>
      </div>
    `;
    list.appendChild(card);
  });
}

function deleteHistory(id) {
  const next = getHistory().filter((item) => item.id !== id);
  setHistory(next);
  renderHistory();
}

async function copyHistory(id) {
  const item = getHistory().find((entry) => entry.id === id);
  if (!item) return;
  try {
    await navigator.clipboard.writeText(item.text_report);
    showToast("已複製歷史明細");
  } catch (err) {
    showToast("複製失敗");
  }
}

function formatDateTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function applyStateToInputs() {
  $("periodSelect").value = state.period;
  $("totalKwh").value = state.totalKwh;
  $("billAmount").value = state.billAmount;
  $("manualSharedToggle").checked = state.sharedMode === "manual";
  $("sharedKwh").value = state.sharedKwhManual;
  $("includeSharedNote").checked = state.includeSharedNote;
  $("exportIncludeDate").checked = state.exportIncludeDate;
  $("exportIncludeUrl").checked = state.exportIncludeUrl;
  renderRooms();
}

function resetState() {
  state.period = "";
  state.totalKwh = "";
  state.billAmount = "";
  state.roomCount = 5;
  state.labelMode = "alpha";
  state.rooms = [];
  state.sharedMode = "auto";
  state.sharedKwhManual = "";
  state.allocation = "proportional";
  state.includeSharedNote = false;
  state.exportIncludeDate = true;
  state.exportIncludeUrl = false;
  state.showAvg4 = false;
  ensureRooms();
  applyStateToInputs();
  refreshAll();
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2000);
}

async function copyFeedback() {
  const text = ($("feedbackText").value || "").trim();
  if (!text) {
    showToast("請先輸入回饋內容");
    return;
  }
  const now = formatDateTime(new Date().toISOString());
  const payload = `【租屋電費計算器回饋】\n時間：${now}\n內容：${text}`;
  try {
    await navigator.clipboard.writeText(payload);
    showToast("回饋已複製");
  } catch (err) {
    showToast("複製失敗");
  }
}

