
var db = supabase.createClient(
  "https://fyixpcqbiozmgnhbioow.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5aXhwY3FiaW96bWduaGJpb293Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk5MjAzMDUsImV4cCI6MjA3NTQ5NjMwNX0.QSS8SC6p4ShkV70Y66oJtoS3M_iREGuFNKrvWgf9-pw"
);

const FINNHUB_KEY = 'd6t31ppr01qoqois1r5gd6t31ppr01qoqois1r60';                        



var user         = null;
var holdings     = [];
var transactions = [];
var snapshots    = [];
var cAlloc = null, cPerf = null;

window.onload = function() {
  var saved = localStorage.getItem("pt_user");
  if (saved) { user = JSON.parse(saved); openDashboard(); }
};

async function hashPw(pw) {
  var buf  = new TextEncoder().encode(pw);
  var hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map(function(b) {
    return b.toString(16).padStart(2, "0");
  }).join("");
}

function switchTab(tab) {
  document.getElementById("login-form").style.display  = tab === "login"  ? "block" : "none";
  document.getElementById("signup-form").style.display = tab === "signup" ? "block" : "none";
  document.getElementById("t-login").classList.toggle("active",  tab === "login");
  document.getElementById("t-signup").classList.toggle("active", tab === "signup");
}

async function doSignup() {
  var u = document.getElementById("s-user").value.trim();
  var e = document.getElementById("s-email").value.trim();
  var p = document.getElementById("s-pass").value;
  if (!u || !e || !p)  return err("s-err", "Fill in all fields.");
  if (p.length < 8)    return err("s-err", "Password needs 8+ characters.");
  var hash = await hashPw(p);
  var res  = await db.from("users").insert([{ username: u, email: e, password_hash: hash }]).select("id,username").single();
  if (res.error) return err("s-err", res.error.code === "23505" ? "Username or email taken." : res.error.message);
  user = { id: res.data.id, username: res.data.username };
  localStorage.setItem("pt_user", JSON.stringify(user));
  openDashboard();
}

async function doLogin() {
  var u = document.getElementById("l-user").value.trim();
  var p = document.getElementById("l-pass").value;
  if (!u || !p) return err("l-err", "Fill in both fields.");
  var hash = await hashPw(p);
  var res  = await db.from("users").select("id,username").eq("username", u).eq("password_hash", hash).maybeSingle();
  if (res.error) return err("l-err", res.error.message);
  if (!res.data)  return err("l-err", "Wrong username or password.");
  user = { id: res.data.id, username: res.data.username };
  localStorage.setItem("pt_user", JSON.stringify(user));
  openDashboard();
}

function doLogout() {
  localStorage.removeItem("pt_user");
  user = null; holdings = []; transactions = []; snapshots = [];
  if (cAlloc) { cAlloc.destroy(); cAlloc = null; }
  if (cPerf)  { cPerf.destroy();  cPerf  = null; }
  document.getElementById("auth-page").style.display = "flex";
  document.getElementById("dash-page").style.display = "none";
}

function openDashboard() {
  document.getElementById("auth-page").style.display = "none";
  document.getElementById("dash-page").style.display = "block";
  document.getElementById("nav-user").textContent    = "Hi, " + user.username;
  loadHoldings(); loadTransactions(); loadSnapshots();
startAlertChecker();
goTo("holdings");
}

function goTo(name) {
  var names = ["holdings", "transactions", "analytics", "compare", "alerts"];
  for (var i = 0; i < names.length; i++) {
    document.getElementById("p-" + names[i]).classList.remove("active");
    document.getElementById("n-" + names[i]).classList.remove("active");
  }
  document.getElementById("p-" + name).classList.add("active");
  document.getElementById("n-" + name).classList.add("active");
  if (name === "analytics") drawCharts();
}

async function loadHoldings() {
  var overlay = document.getElementById("loading-overlay");
  overlay.style.display = "flex";
  var res = await db.from("holdings").select("*").eq("user_id", user.id).order("created_at");
  holdings = res.data || [];
  await fetchLivePrices(holdings);
  overlay.style.display = "none";
  showHoldings(); updateStats();
}

async function fetchLivePrices(holdings) {
  for (var i = 0; i < holdings.length; i++) {
    var h = holdings[i];
    try {
      var res  = await fetch("https://finnhub.io/api/v1/quote?symbol=" + h.ticker + "&token=" + FINNHUB_KEY);
      var data = await res.json();
      if (data.c && data.c > 0) {
        h._cur = data.c;
      }
    } catch (e) {
      console.log("Could not fetch price for " + h.ticker);
    }
  }
}

async function fetchLivePrices(holdings) {
  for (var i = 0; i < holdings.length; i++) {
    var h = holdings[i];
    try {
      var res  = await fetch("https://finnhub.io/api/v1/quote?symbol=" + h.ticker + "&token=" + FINNHUB_KEY);
      var data = await res.json();
      if (data.c && data.c > 0) {
        h._cur = data.c;
      }
    } catch (e) {
      console.log("Could not fetch price for " + h.ticker);
    }
  }
}

var tickerTimer;
async function searchTicker(query) {
  var box = document.getElementById("ticker-suggestions");
  clearTimeout(tickerTimer);
  if (!query || query.length < 2) { box.style.display = "none"; return; }
  tickerTimer = setTimeout(async function() {
    try {
      var res  = await fetch("https://finnhub.io/api/v1/search?q=" + query + "&token=" + FINNHUB_KEY);
      var data = await res.json();
      if (!data.result || !data.result.length) { box.style.display = "none"; return; }
      var html = ""; var shown = 0;
      for (var i = 0; i < data.result.length && shown < 6; i++) {
        var r = data.result[i];
        if (r.type !== "Common Stock") continue;
        html += "<div onclick=\"pickTicker('" + r.symbol + "')\" style='padding:9px 12px;cursor:pointer;border-bottom:1px solid #eee;font-size:13px;'>" +
                "<strong>" + r.symbol + "</strong><span style='color:#888;font-size:11px;margin-left:6px;'>" + r.description + "</span></div>";
        shown++;
      }
      if (!shown) { box.style.display = "none"; return; }
      box.innerHTML = html;
      box.style.display = "block";
    } catch(e) { box.style.display = "none"; }
  }, 400);
}

function pickTicker(symbol) {
  document.getElementById("h-tick").value = symbol;
  document.getElementById("ticker-suggestions").style.display = "none";
}

document.addEventListener("click", function(e) {
  if (e.target.id !== "h-tick") {
    document.getElementById("ticker-suggestions").style.display = "none";
  }
});
function pickTicker(symbol) {
  document.getElementById("h-tick").value = symbol;
  document.getElementById("ticker-suggestions").style.display = "none";
}

document.addEventListener("click", function(e) {
  if (e.target.id !== "h-tick") {
    document.getElementById("ticker-suggestions").style.display = "none";
  }
});

async function addHolding() {
  var tick = document.getElementById("h-tick").value.trim().toUpperCase();
  var shr  = parseFloat(document.getElementById("h-shr").value);
  var avg  = parseFloat(document.getElementById("h-avg").value);
  if (!tick || isNaN(shr) || shr <= 0 || isNaN(avg) || avg <= 0)
    return err("h-err", "Please fill in all fields with valid values.");
  document.getElementById("h-err").style.display = "none";

  var res = await db.from("holdings").insert([{ user_id: user.id, ticker: tick, shares: shr, avg_price: avg }]).select().single();
  if (res.error) return err("h-err", res.error.message);
  await db.from("transactions").insert([{ user_id: user.id, ticker: tick, transaction_type: "BUY", shares: shr, price: avg }]);

  holdings.push(res.data);
  await fetchLivePrices(holdings);
  showHoldings(); updateStats(); loadTransactions(); toast("Added " + tick);
  ["h-tick","h-shr","h-avg"].forEach(function(id) { document.getElementById(id).value = ""; });
}

async function delHolding(id, tick) {
  await db.from("holdings").delete().eq("id", id).eq("user_id", user.id);
  holdings = holdings.filter(function(h) { return h.id !== id; });
  showHoldings(); updateStats(); toast("Removed " + tick);
}

function showHoldings() {
  var tbody = document.getElementById("h-body");
  if (!holdings.length) { tbody.innerHTML = '<tr class="empty"><td colspan="9">No holdings yet.</td></tr>'; return; }
  var html = "";
  for (var i = 0; i < holdings.length; i++) {
    var h    = holdings[i];
    var cur  = h._cur !== undefined ? h._cur : h.avg_price;
    var cost = h.shares * h.avg_price;
    var val  = h.shares * cur;
    var gain = val - cost;
    var pct  = cost > 0 ? (gain / cost) * 100 : 0;
    var cls  = gain >= 0 ? "green" : "red";
    var sign = gain >= 0 ? "+" : "";
    html += "<tr><td class='tick'>" + h.ticker + "</td><td>" + f(h.shares,4) + "</td><td>$" + f(h.avg_price) + "</td><td>$" + f(cur) + "</td><td>$" + f(cost) + "</td><td>$" + f(val) + "</td><td class='" + cls + "'>" + sign + "$" + f(gain) + "</td><td class='" + cls + "'>" + sign + f(pct,2) + "%</td><td><button class='del-btn' onclick=\"delHolding('" + h.id + "','" + h.ticker + "')\">Remove</button></td></tr>";
  }
  tbody.innerHTML = html;
}

function updateStats() {
  var tv = 0, tc = 0;
  holdings.forEach(function(h) {
    var cur = h._cur !== undefined ? h._cur : h.avg_price;
    tv += h.shares * cur;
    tc += h.shares * h.avg_price;
  });
  var gain = tv - tc;
  var pct  = tc > 0 ? (gain / tc) * 100 : 0;
  var cls  = gain >= 0 ? "green" : "red";
  var sign = gain >= 0 ? "+" : "";
  document.getElementById("s-total").textContent = "$" + f(tv);
  document.getElementById("s-cost").textContent  = "$" + f(tc);
  document.getElementById("s-gain").textContent  = sign + "$" + f(gain);
  document.getElementById("s-gain").className    = "val " + cls;
  document.getElementById("s-pct").textContent   = sign + f(pct,2) + "%";
  document.getElementById("s-pct").className     = "val " + cls;
}

async function loadTransactions() {
  var res = await db.from("transactions").select("*").eq("user_id", user.id).order("transaction_date", { ascending: false });
  transactions = res.data || [];
  showTransactions();
}

async function addTransaction() {
  var type = document.getElementById("t-type").value;
  var tick = document.getElementById("t-tick").value.trim().toUpperCase();
  var shr  = parseFloat(document.getElementById("t-shr").value);
  var prc  = parseFloat(document.getElementById("t-prc").value);
  if (!tick || isNaN(shr) || shr <= 0 || isNaN(prc) || prc <= 0)
    return err("t-err", "Fill in all fields with valid values.");
  document.getElementById("t-err").style.display = "none";
  var res = await db.from("transactions").insert([{ user_id: user.id, ticker: tick, transaction_type: type, shares: shr, price: prc }]).select().single();
  if (res.error) return err("t-err", res.error.message);
  transactions.unshift(res.data);
  showTransactions(); toast("Logged " + type + " " + tick);
  ["t-tick","t-shr","t-prc"].forEach(function(id) { document.getElementById(id).value = ""; });
}

function showTransactions() {
  var tbody = document.getElementById("t-body");
  if (!transactions.length) { tbody.innerHTML = '<tr class="empty"><td colspan="6">No transactions yet.</td></tr>'; return; }
  var html = "";
  for (var i = 0; i < transactions.length; i++) {
    var t    = transactions[i];
    var date = new Date(t.transaction_date).toLocaleDateString("en-GB");
    var badge = t.transaction_type === "BUY"
      ? "<span style='background:#e8f5e9;color:#2e7d32;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:bold'>BUY</span>"
      : "<span style='background:#fdecea;color:#c62828;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:bold'>SELL</span>";
    html += "<tr><td>" + date + "</td><td>" + badge + "</td><td class='tick'>" + t.ticker + "</td><td>" + f(t.shares,4) + "</td><td>$" + f(t.price) + "</td><td>$" + f(t.shares * t.price) + "</td></tr>";
  }
  tbody.innerHTML = html;
}

async function loadSnapshots() {
  var res = await db.from("portfolio_snapshots").select("*").eq("user_id", user.id).order("snapshot_date");
  snapshots = res.data || [];
  showSnapshots();
}

async function saveSnapshot() {
  var tv = 0;
  holdings.forEach(function(h) {
    tv += h.shares * (h._cur !== undefined ? h._cur : h.avg_price);
  });
  var res = await db.from("portfolio_snapshots").insert([{ user_id: user.id, portfolio_value: tv }]).select().single();
  if (res.error) return toast("Snapshot failed.");
  snapshots.push(res.data);
  showSnapshots(); toast("Snapshot saved!");
  var m = document.getElementById("snap-msg");
  m.textContent   = "Saved! Portfolio value: $" + f(tv);
  m.style.display = "block";
}

function showSnapshots() {
  var tbody = document.getElementById("snap-body");
  if (!snapshots.length) { tbody.innerHTML = '<tr class="empty"><td colspan="3">No snapshots yet.</td></tr>'; return; }
  var list = snapshots.slice().reverse();
  var html = "";
  for (var i = 0; i < list.length; i++) {
    var s    = list[i];
    var prev = list[i + 1];
    var date = new Date(s.snapshot_date).toLocaleString("en-GB");
    var chg  = "<td style='color:#aaa'>--</td>";
    if (prev) {
      var diff = s.portfolio_value - prev.portfolio_value;
      var pct  = prev.portfolio_value > 0 ? (diff / prev.portfolio_value) * 100 : 0;
      var cls  = diff >= 0 ? "green" : "red";
      var sign = diff >= 0 ? "+" : "";
      chg = "<td class='" + cls + "'>" + sign + "$" + f(diff) + " (" + sign + f(pct,2) + "%)</td>";
    }
    html += "<tr><td>" + date + "</td><td>$" + f(s.portfolio_value) + "</td>" + chg + "</tr>";
  }
  tbody.innerHTML = html;
}

function drawCharts() {
  if (cAlloc) { cAlloc.destroy(); cAlloc = null; }
  if (cPerf)  { cPerf.destroy();  cPerf  = null; }
  if (!holdings.length) return;

  var labels  = [], values = [], gains = [], colors = [];
  var palette = ["#4caf50","#2196f3","#ff9800","#9c27b0","#f44336","#00bcd4","#ff5722","#607d8b"];

  for (var i = 0; i < holdings.length; i++) {
    var h    = holdings[i];
    var cur  = h._cur !== undefined ? h._cur : h.avg_price;
    var gain = (h.shares * cur) - (h.shares * h.avg_price);
    labels.push(h.ticker);
    values.push(parseFloat((h.shares * cur).toFixed(2)));
    gains.push(parseFloat(gain.toFixed(2)));
    colors.push(gain >= 0 ? "#4caf50" : "#e53935");
  }

  cAlloc = new Chart(document.getElementById("c-alloc"), {
    type: "doughnut",
    data: { labels: labels, datasets: [{ data: values, backgroundColor: palette, borderWidth: 2, borderColor: "#fff" }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "right" } } }
  });

  cPerf = new Chart(document.getElementById("c-perf"), {
    type: "bar",
    data: { labels: labels, datasets: [{ label: "Gain/Loss ($)", data: gains, backgroundColor: colors, borderRadius: 4 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { grid: { display: false } }, y: { ticks: { callback: function(v) { return "$" + v; } } } }
    }
  });
}

function f(n, dp) {
  dp = dp !== undefined ? dp : 2;
  return parseFloat(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function err(id, msg) {
  var el = document.getElementById(id);
  el.textContent = msg; el.style.display = "block";
}

var toastT;
function toast(msg) {
  var el = document.getElementById("toast");
  el.textContent = msg; el.style.display = "block";
  clearTimeout(toastT);
  toastT = setTimeout(function() { el.style.display = "none"; }, 3000);
}

function exportCSV() {
  if (!holdings.length) return toast("No holdings to export.");
  var rows = [["Ticker","Shares","Avg Price","Live Price","Cost","Value","Gain/Loss","Return %"]];
  for (var i = 0; i < holdings.length; i++) {
    var h    = holdings[i];
    var cur  = h._cur !== undefined ? h._cur : h.avg_price;
    var cost = h.shares * h.avg_price;
    var val  = h.shares * cur;
    var gain = val - cost;
    var pct  = cost > 0 ? (gain / cost) * 100 : 0;
    rows.push([h.ticker, h.shares, h.avg_price.toFixed(2), cur.toFixed(2), cost.toFixed(2), val.toFixed(2), gain.toFixed(2), pct.toFixed(2)]);
  }
  var csv    = rows.map(function(r) { return r.join(","); }).join("\n");
  var blob   = new Blob([csv], { type: "text/csv" });
  var url    = URL.createObjectURL(blob);
  var a      = document.createElement("a");
  a.href     = url;
  a.download = "portfolio_" + new Date().toISOString().slice(0,10) + ".csv";
  a.click();
  URL.revokeObjectURL(url);
  toast("Exported to CSV!");
}

var alerts       = JSON.parse(localStorage.getItem("pt_alerts") || "[]");
var alertInterval = null;

function saveAlert() {
  var tick   = document.getElementById("alert-tick").value.trim().toUpperCase();
  var target = parseFloat(document.getElementById("alert-price").value);
  var dir    = document.getElementById("alert-dir").value;
  if (!tick || isNaN(target) || target <= 0) return toast("Fill in all alert fields.");
  alerts.push({ ticker: tick, target: target, direction: dir, triggered: false });
  localStorage.setItem("pt_alerts", JSON.stringify(alerts));
  document.getElementById("alert-tick").value  = "";
  document.getElementById("alert-price").value = "";
  showAlerts();
  toast("Alert set for " + tick);
}

function deleteAlert(i) {
  alerts.splice(i, 1);
  localStorage.setItem("pt_alerts", JSON.stringify(alerts));
  showAlerts();
}

function showAlerts() {
  var tbody = document.getElementById("alert-body");
  if (!alerts.length) { tbody.innerHTML = '<tr class="empty"><td colspan="4">No alerts set.</td></tr>'; return; }
  var html = "";
  for (var i = 0; i < alerts.length; i++) {
    var a    = alerts[i];
    var cls  = a.triggered ? "green" : "";
    var stat = a.triggered ? "Triggered" : "Watching";
    html += "<tr><td class='tick'>" + a.ticker + "</td><td>" + (a.direction === "above" ? "Goes above" : "Goes below") + " $" + f(a.target) + "</td><td class='" + cls + "'>" + stat + "</td><td><button class='del-btn' onclick='deleteAlert(" + i + ")'>Remove</button></td></tr>";
  }
  tbody.innerHTML = html;
}

function startAlertChecker() {
  if (alertInterval) clearInterval(alertInterval);
  alertInterval = setInterval(async function() {
    if (!alerts.length) return;
    for (var i = 0; i < alerts.length; i++) {
      var a = alerts[i];
      if (a.triggered) continue;
      try {
        var res  = await fetch("https://finnhub.io/api/v1/quote?symbol=" + a.ticker + "&token=" + FINNHUB_KEY);
        var data = await res.json();
        if (!data.c || data.c <= 0) continue;
        var hit = (a.direction === "above" && data.c >= a.target) ||
                  (a.direction === "below" && data.c <= a.target);
        if (hit) {
          a.triggered = true;
          localStorage.setItem("pt_alerts", JSON.stringify(alerts));
          showAlerts();
          showAlertPopup(a.ticker, a.direction, a.target, data.c);
        }
      } catch(e) {}
    }
  }, 30000);
}

function showAlertPopup(ticker, dir, target, current) {
  var msg = ticker + " is now $" + f(current) + " — " + (dir === "above" ? "above" : "below") + " your target of $" + f(target);
  document.getElementById("alert-popup-msg").textContent = msg;
  document.getElementById("alert-popup").style.display   = "block";
  setTimeout(function() { document.getElementById("alert-popup").style.display = "none"; }, 8000);
}
