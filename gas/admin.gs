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
 *
 * ── LINE自動投稿のセットアップ手順 ────────────────────────
 * 1. https://developers.line.biz/console/ にログイン（LINEビジネスIDを作成）
 * 2. プロバイダーを作成 → 「Messaging API」チャネルを作成
 *    （LINE公式アカウントが自動で作られます。名前は「BAR 日報bot」など）
 * 3. チャネルの「Messaging API設定」タブで
 *    「チャネルアクセストークン（長期）」を発行 → 下の LINE_CHANNEL_ACCESS_TOKEN に貼る
 * 4. 同じタブで Webhook URL に このGASのウェブアプリURL（…/exec）を設定し、
 *    「Webhookの利用」をON。「応答メッセージ」はOFF推奨
 * 5. トークン貼り付け後、新バージョンで再デプロイ
 * 6. LINE公式アカウントの設定で「グループ・複数人トークへの参加を許可する」をON
 *    （LINE Official Account Manager → 設定 → 応答設定）
 * 7. botをスタッフのグループLINEに招待
 *    → 招待された瞬間にWebhookが飛び、グループIDが自動保存されます
 * 8. 確認: ブラウザで「ウェブアプリURL?mode=lineStatus&pass=パスワード」を開き
 *    {"token":true,"target":true} なら設定完了。日報の「完了」で自動投稿されます
 */

// ══ 設定（ここを書き換える）═══════════════════════════════
const SPREADSHEET_ID    = 'ここにスプレッドシートIDを貼る';
const REPORT_SHEET_NAME = 'シート1';    // 日報が記録されているシート名
const MEMBER_SHEET_NAME = 'メンバー';   // メンバー管理用シート（無ければ自動作成）
const ADMIN_PASSWORD    = 'ここにパスワードを設定';
// LINE Messaging API のチャネルアクセストークン（未設定ならLINE送信はスキップ）
const LINE_CHANNEL_ACCESS_TOKEN = '';

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
      case 'sendLine':       // 日報アプリからの自動投稿（パスワード不要）
        result = sendLine(p.text); break;
      case 'lineStatus':     // LINE設定の確認用
        checkPass(p.pass);
        result = {
          token: !!LINE_CHANNEL_ACCESS_TOKEN,
          target: !!PropertiesService.getScriptProperties().getProperty('LINE_TARGET_ID')
        };
        break;
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

// ══ LINE 自動投稿 ════════════════════════════════════════
// LINE の Webhook 受信。botがグループに招待される／グループで発言があると
// そのグループIDを保存し、以後の日報自動投稿の宛先にする。
function doPost(e){
  try{
    const body = JSON.parse(e.postData.contents);
    (body.events || []).forEach(function(ev){
      const src = ev.source || {};
      const id = src.groupId || src.roomId || src.userId;
      if(id && (ev.type === 'join' || ev.type === 'memberJoined' || ev.type === 'message')){
        PropertiesService.getScriptProperties().setProperty('LINE_TARGET_ID', id);
      }
    });
  }catch(err){ /* Webhook検証など空のリクエストは無視 */ }
  return ContentService.createTextOutput('ok');
}

function sendLine(text){
  text = String(text || '').trim();
  if(!text) throw new Error('本文が空です');
  if(!LINE_CHANNEL_ACCESS_TOKEN) throw new Error('LINEトークン未設定');
  const target = PropertiesService.getScriptProperties().getProperty('LINE_TARGET_ID');
  if(!target) throw new Error('送信先グループが未登録です（botをグループに招待してください）');
  const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    contentType: 'application/json',
    headers: {Authorization: 'Bearer ' + LINE_CHANNEL_ACCESS_TOKEN},
    payload: JSON.stringify({to: target, messages: [{type: 'text', text: text}]}),
    muteHttpExceptions: true
  });
  if(res.getResponseCode() !== 200){
    throw new Error('LINE送信失敗: ' + res.getContentText().slice(0, 200));
  }
  return {ok: true};
}

// ══ 日報データ ═══════════════════════════════════════════
// 全行を生の配列で返す（A列=index 0、B列=index 1 …）。列の対応は admin.html 側で
// A=店舗 / B=日付 / C=担当 / D=組数 / H=売上合計 / U=発注内容 として参照する。
// 日付セルは yyyy-MM-dd 文字列に変換。ヘッダー行は admin.html 側の日付判定で除外される。
function getReports(){
  const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(REPORT_SHEET_NAME);
  if(!sh) throw new Error('日報シートが見つかりません: ' + REPORT_SHEET_NAME);
  return sh.getDataRange().getValues().map(function(r){
    return r.map(function(v){
      return (v instanceof Date) ? Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd') : v;
    });
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
