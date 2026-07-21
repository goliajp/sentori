// 日本語。型は `Messages` — en.ts にキーを足してここに足し忘れると
// コンパイルエラーになる。英語のまま漏れることはない。

import type { Messages } from './en';

export const ja: Messages = {
  'action.cancel': 'キャンセル',
  'action.copy': 'コピー',
  'action.create': '作成',
  'action.delete': '削除',
  'action.dismiss': '閉じる',
  'action.refresh': '更新',
  'action.retry': '再試行',
  'action.save': '保存',
  'action.signOut': 'サインアウト',

  'common.error': 'エラーが発生しました',
  'common.loading': '読み込み中…',
  'common.none': 'なし',
  'common.search': '検索',

  'nav.alerts': 'アラート',
  'nav.audit': '監査ログ',
  'nav.billing': '請求',
  'nav.cert': '証明書モニター',
  'nav.events': 'イベント',
  'nav.health': 'ヘルス',
  'nav.inbox': '受信箱',
  'nav.integrations': '連携',
  'nav.issues': 'イシュー',
  'nav.members': 'メンバー',
  'nav.metrics': 'メトリクス',
  'nav.overview': '概要',
  'nav.probes': 'エンドポイント監視',
  'nav.projects': 'プロジェクト',
  'nav.push': 'プッシュ通知',
  'nav.releases': 'リリース',
  'nav.replays': 'リプレイ',
  'nav.saasAdmin': 'SaaS 管理',
  'nav.savedViews': '保存したビュー',
  'nav.search': '検索',
  'nav.sectionProject': 'プロジェクト',
  'nav.sectionWorkspace': 'ワークスペース',
  'nav.settings': '設定',
  'nav.tokens': 'トークン',
  'nav.traces': 'トレース',

  'prefs.language': '言語',
  'prefs.theme': 'テーマ',
  'prefs.themeDark': 'ダーク',
  'prefs.themeLight': 'ライト',
  'prefs.themeSystem': 'システムに合わせる',
};
