# M-4 音声の公式確認

確認日: 2026-10-04。公開一次資料の本文を確認した。実fal/Google/Elevenへの生成・計数・認証接続は行っていない。価格/アカウント利用権限、上流ACL/保持は未確認。

| 一次資料 | 確認内容・採否・留保 |
| --- | --- |
| [fal Gemini Flash TTS](https://fal.ai/models/google/gemini-3.8-flash-tts/api) / [Flash Lite TTS](https://fal.ai/models/google/gemini-3.8-flash-lite-tts/api) | promptとstyle_instructionsの分離、固定30音声、speakers/turnsとspeaker_id、単一/2話者の排他、全入力8192 tokens、audio/WAVを採用。出力例のimage/png・空URLは正解として使わない |
| [fal Eleven v4 TTS](https://fal.ai/models/elevenlabs/tts/eleven-v4/api) | text/voice/stability/similarity_boost/seed/language_code/output_format/apply_text_normalization。アプリの許可voiceとISO639-1部分集合、MP3形式へ限定。timestamps/streaming/raw PCMを除外。例の別CDNを非公開保証と扱わない |
| [fal Music v2.5](https://fal.ai/models/elevenlabs/music/v2.5/api) | music_length_ms、force_instrumental、MP3を採用。公式3,000〜600,000msより狭い採用済み3〜60秒を明示送信。seedはcomposition_plan専用で、双方を拒否。例のGoogle Storageを非公開保存へのfallback先にしない |
| [Google TTS](https://ai.google.dev/gemini-api/docs/speech-generation) | WAV出力とPCM16/24kHz/monoの例を確認し、初版WAVの保守的な仕様に採用。Google直接APIのspeech_metadata等をfal wrapperの入力へ混ぜない |
| [Google token counting](https://ai.google.dev/gemini-api/docs/tokens) / [countTokens API](https://ai.google.dev/api/tokens) | モデル固有のtokenizerによる計数と、文字の平均値は別。実APIを呼ばず、平均約4文字/tokenを検証式にしない。対象fal wrapperとモデル固有のローカルtokenizer対応は未確認 |
| [Google SentencePiece](https://github.com/google/sentencepiece/blob/master/python/README.md) | byte fallbackは未登録文字をbyte tokenに分割する。これを一般的な保守的受付の根拠とし、NFKC展開と4倍/固定余裕を加えた。対象Gemini tokenizer/wrapperの上限保証とは扱わず、実gateの追加確認条件へ残す |
| [Microsoft WAVEFORMATEX](https://learn.microsoft.com/en-us/windows/win32/api/mmreg/ns-mmreg-waveformatex) | PCMのchannels/sampleRate/bits/blockAlign/byteRateの相互関係を検査へ採用 |
| [FFmpeg MPEG audio header](https://github.com/FFmpeg/FFmpeg/blob/master/libavcodec/mpegaudiodecheader.c) | MPEG1 LayerIIIのsample数1152とbitrate/sampleRateに基づくframe長を独立実装の照合資料として使用。FFmpegコードはコピーせず、完全デコードを行った証拠にしない |
| [Cloudflare Vite API](https://developers.cloudflare.com/workers/vite-plugin/reference/api/) / [local data](https://developers.cloudflare.com/workers/local-development/local-data/) | persistStateの専用pathとWrangler --persist-toの一致、remoteBindings falseを採用。既存4.141.0のCLI helpとVite plugin1.60.2型定義も照合。クラウドPreviewsを作成した意味ではない |

アプリの受付・検査条件とproviderの保証を分ける。実上流の入力token/形式/利用権限、Store-IO/ACL/保持/非同期回収を工程Eで確認するまで、MEDIA_VERIFIED_AUDIO_MODELSは実環境で空を維持する。詳細は[M-4設定メモ](../docs/M4-音声4モデルとprivate再生.md)。
