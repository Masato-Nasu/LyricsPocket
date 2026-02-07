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


## 使い勝手改善（AutoJP版）

- 曲を再生/切替すると、歌詞（同名/ゆる正規化）を自動で選択して表示します。
- `ONLINE JP` がONのとき、英文の真下に日本語訳を自動で表示します（順次翻訳）。
- 失敗して空欄の行は、その行をタップすると下部に `OPEN/COPY` が出ます。


## AutoJP2（今回の改善）

- 曲を選択/再生した瞬間に、歌詞を自動選択して表示（同名/ゆる正規化＋保存リンク）
- 英文の直下に日本語訳を自動表示（現在行を最優先で翻訳）
