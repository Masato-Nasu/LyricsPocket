# LyricsPocket PWA

ローカル音源（mp3/m4a 等）と、ローカル歌詞（.txt / .lrc）を読み込んで、
ミニマルUIで再生・同期表示し、行タップで日本語化する PWA テンプレです。

> 注意（iPhoneの制約）
> - iOS Safari/PWAは **フォルダ選択 API（showDirectoryPicker / File System Access API）未対応**のため、iPhoneでは `FILES` から複数選択が基本になります。
> - **ホーム画面に追加した“PWA(standalone)”は、バックグラウンドで音声が止まる既知の制約**があります。  
>   その場合は「Safariタブで再生」運用が安定しやすいです。

## 使い方

1. `FILES` で音声ファイルを複数選択（PC/Androidは `FOLDER` も可）
2. `LYRICS` で `.txt` / `.lrc` を読み込み
3. **同名ルール**で自動リンク：  
   `Song.m4a` と `Song.lrc`（または `Song.txt`）
4. LRCなら再生位置に合わせて自動ハイライト
5. 歌詞行をタップすると翻訳  
   - `ONLINE JP: OFF` → 行をクリップボードにコピー（端末の翻訳機能へ）
   - `ONLINE JP: ON` → MyMemoryで英→日翻訳（キー不要・簡易）

## GitHub Pages にデプロイ

- リポジトリのルートにこのフォルダ一式を置く
- Settings → Pages → Deploy from a branch → `main` / `/root`
- 生成URLにアクセスして動作確認

## 開発（ローカル）

Service Workerの都合で、ローカルファイル直開きではなく簡易サーバを使ってください。

例（Python）:
```bash
python -m http.server 8000
```

## samples

`samples/` にダミーの歌詞ファイルを同梱しています（著作物は含みません）。


## 日本語訳（JPfix版）

- `ONLINE JP` は初期状態で **ON**（タップで日本語が出ます）
- 失敗時は `OPEN`（Google翻訳）/`COPY` を表示
- Service Worker のキャッシュ名を更新済み（反映しやすい）
