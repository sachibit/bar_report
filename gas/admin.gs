/**
 * BAR REPORT 管理用 API（データ読み取り・メンバー管理）
 *
 * 既存の日報送信用GASとは【別の】Apps Script プロジェクトとしてデプロイしてください。
 * （既存の記録処理には一切手を加えません）
 *
 * ── セットアップ手順 ──────────────────────────────────────
 * 1. https://script.google.com で「新しいプロジェクト」を作成
 * 2. このファイルの内容を Code.gs に貼り付け
 * 3. 下の SPREADSHEET_ID を日報スプレッドシートのIDに書き換える
 *    （シートのURL https://docs.google.com/spreadsheets/d/【この部分】/edit ）
 * 4. REPORT_SHEET_NAME を日報が記録されているシート名（画面下のタブ名）に合わせる
 * 5. ADMIN_PASSWORD を好きなパスワードに変更（admin.html のログインで使います）
 * 6. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
 *      - 実行ユーザー: 自分
 *      - アクセスできるユーザー: 全員
 *    → 承認を求められたら許可する
 * 7. 表示されたウェブアプリURL（https://script.google.com/macros/s/…/exec）を
 *      - admin.html の ADMIN_GAS_URL
 *      - index.html の ADMIN_GAS_URL
 *    の2箇所に貼る
 * 8. 動作確認: ブラウザで「ウェブアプリURL?mode=members」を開き、
 *    メンバー一覧のJSONが表示されればOK
 *
 * ※ コードを修正した場合は「デプロイ」→「デプロイを管理」→ 編集（鉛筆）→
 *   バージョン「新バージョン」で再デプロイしないと反映されません。
 */

// ══ 設定（ここを書き換える）═══════════════════════════════
const SPREADSHEET_ID    = 'ここにスプレッドシートIDを貼る';
const REPORT_SHEET_NAME = 'シート1';    // 日報が記録されているシート名
const MEMBER_SHEET_NAME = 'メンバー';   // メンバー管理用シート（無ければ自動作成）
const ADMIN_PASSWORD    = 'ここにパスワードを設定';

// 初期メンバー（メンバーシートが無いとき、最初のアクセス時に自動登録される）
const SEED_MEMBERS = [
  {name:'莉乃',   yomi:'りの'},
  {name:'もも',   yomi:'もも'},
  {name:'叶',     yomi:'かな'},
  {name:'とも',   yomi:'とも'},
  {name:'幸',     yomi:'さち'},
  {name:'あいり', yomi:'あいり'},
  {name:'ちひろ', yomi:'ちひろ'},
  {name:'竜',     yomi:'りゅう'},
  {name:'竜聖',   yomi:'りゅうせい'},
  {name:'まき',   yomi:'まき'},
  {name:'コウ',   yomi:'こう'}
];

// ══ エントリーポイント ═══════════════════════════════════
function doGet(e){
  const p = (e && e.parameter) || {};
  let result;
  try{
    switch(p.mode){
      case 'members':          // 日報アプリが使う（パスワード不要・表示中のみ）
        result = {members: getMembers(false)}; break;
      case 'login':
        checkPass(p.pass); result = {ok: true}; break;
      case 'reports':
        checkPass(p.pass); result = {reports: getReports()}; break;
      case 'allMembers':       // 管理画面用（非表示メンバーも含む）
        checkPass(p.pass); result = {members: getMembers(true)}; break;
      case 'addMember':
        checkPass(p.pass); result = addMember(p.name, p.yomi); break;
      case 'setMemberActive':
        checkPass(p.pass); result = setMemberActive(p.name, p.active); break;
      default:
        result = {error: 'unknown mode'};
    }
  }catch(err){
    result = {error: err && err.message === 'auth' ? 'auth' : String(err)};
  }
  const json = JSON.stringify(result);
  if(p.callback){ // JSONP（index.html / admin.html からの呼び出し）
    return ContentService.createTextOutput(p.callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function checkPass(pass){
  if(String(pass || '') !== ADMIN_PASSWORD) throw new Error('auth');
}

// ══ 日報データ ═══════════════════════════════════════════
// 1行目をヘッダーとして各行をオブジェクトで返す。日付セルは yyyy-MM-dd 文字列に変換。
function getReports(){
  const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(REPORT_SHEET_NAME);
  if(!sh) throw new Error('日報シートが見つかりません: ' + REPORT_SHEET_NAME);
  const rows = sh.getDataRange().getValues();
  if(rows.length < 2) return [];
  const head = rows[0].map(function(h){ return String(h).trim(); });
  return rows.slice(1).map(function(r){
    const o = {};
    head.forEach(function(h, i){
      if(!h) return;
      o[h] = (r[i] instanceof Date)
        ? Utilities.formatDate(r[i], 'Asia/Tokyo', 'yyyy-MM-dd')
        : r[i];
    });
    return o;
  });
}

// ══ メンバー管理 ═════════════════════════════════════════
function memberSheet(){
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sh = ss.getSheetByName(MEMBER_SHEET_NAME);
  if(!sh){
    sh = ss.insertSheet(MEMBER_SHEET_NAME);
    sh.appendRow(['名前', 'よみがな', '表示']);
    SEED_MEMBERS.forEach(function(m){ sh.appendRow([m.name, m.yomi, 1]); });
  }
  return sh;
}

function getMembers(includeHidden){
  const rows = memberSheet().getDataRange().getValues();
  const out = [];
  for(let i = 1; i < rows.length; i++){
    const name = String(rows[i][0] || '').trim();
    if(!name) continue;
    const active = String(rows[i][2]) !== '0';
    if(includeHidden || active){
      out.push({name: name, yomi: String(rows[i][1] || ''), active: active ? 1 : 0});
    }
  }
  return out;
}

function addMember(name, yomi){
  name = String(name || '').trim();
  if(!name) throw new Error('名前が空です');
  const dup = getMembers(true).some(function(m){ return m.name === name; });
  if(dup) throw new Error('同名のメンバーが既に存在します');
  memberSheet().appendRow([name, String(yomi || '').trim(), 1]);
  return {ok: true};
}

function setMemberActive(name, active){
  const sh = memberSheet();
  const rows = sh.getDataRange().getValues();
  for(let i = 1; i < rows.length; i++){
    if(String(rows[i][0]).trim() === String(name || '').trim()){
      sh.getRange(i + 1, 3).setValue(String(active) === '1' ? 1 : 0);
      return {ok: true};
    }
  }
  throw new Error('メンバーが見つかりません: ' + name);
}
