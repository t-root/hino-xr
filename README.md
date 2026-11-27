# HINO XR

Ứng dụng web XR cho điện thoại đặt trong kính: mở camera, vẽ **hai mắt (stereo)** với ảnh camera làm nền, điều khiển bằng **cử chỉ tay** và **giọng nói**, nhận diện vật thể bằng các **plugin** chạy cục bộ, và có một **trợ lý nói chuyện tên HINO** chạy trên máy tính.

Mọi giao diện bán trong suốt, một màu, góc vuông, vẽ chồng lên ảnh camera.

## Chạy nhanh

Cần **Python 3.11 trở lên** (chạy bằng `py -3.11 run.py`). Không dùng Node.js, không `npm`, không `node_modules`.

```bash
python run.py        # hồ sơ cpu (mặc định): https://127.0.0.1:5173; hồ sơ gpu: http://127.0.0.1:5173 và một địa chỉ công khai
VR_PROFILE=gpu python run.py   # (PowerShell: $env:VR_PROFILE="gpu"; python run.py)
python run.py test   # chạy toàn bộ unittest
```

### Hai hồ sơ: `cpu` và `gpu`

Một mã nguồn. Khi bạn chạy `run.py`, nó **hỏi** `[cpu/gpu] (Enter = cpu)`: Enter là `cpu`, gõ `gpu` là `gpu`, không phải sửa file nào. Không hỏi nếu đã đặt sẵn `VR_PROFILE=cpu|gpu` (ở môi trường hoặc `assistant/.env`, để chạy không cần ai trả lời), hoặc nếu không có ai để trả lời (chạy nền, qua pipe): khi đó là `cpu`. Chỉ những chỗ trong bảng này khác nhau; mọi thứ còn lại dùng chung.

| | `cpu` (mặc định) | `gpu` |
|---|---|---|
| Máy | không có card NVIDIA, ví dụ laptop 4 nhân, 16 GB RAM | máy chủ thuê có GPU (thiết kế cho RTX 16 GB), chỉ Windows (bản CUDA) |
| Model (`assistant/ai/stages.<hồ sơ>.json`) | Qwen3-VL 4B, Qwen2.5-Coder 3B, Whisper small (một máy chủ cho `stt` và `stt_wake`); llama.cpp và whisper.cpp bản CPU | Qwen3-VL 8B, Qwen2.5-Coder 14B (cùng `group: "gpu"`), Whisper large-v3 q5; llama.cpp CUDA 13.5, whisper.cpp CUDA 12.4 |
| Tải về (`downloads.json`, trường `profile`) | khoảng 7 GB | khoảng 17 GB, thêm `cloudflared` |
| Mạng | HTTPS tự ký trên `0.0.0.0:5173`, mở trình duyệt, in địa chỉ LAN cho điện thoại cùng Wi-Fi | HTTP trên `127.0.0.1:5173`; `run.py` mở tunnel Cloudflare và in địa chỉ `https://....trycloudflare.com` (mới mỗi lần chạy) |
| Khoá truy cập | tắt mặc định | bật khi có tunnel |
| `VR_TUNNEL` | không có tác dụng | `off` = không mở tunnel, trang chỉ mở được trên chính máy này |

Đổi hồ sơ trên cùng một thư mục thì `run.py` tải thêm phần của hồ sơ mới; file của hồ sơ cũ vẫn nằm đó. Hai hồ sơ dùng chung thư mục `assistant/bin/llama` và `assistant/bin/whisper`: nếu gặp chương trình sai bản sau khi đổi hồ sơ, xoá hai thư mục đó rồi chạy lại để tải đúng bản. Hồ sơ `gpu` chưa được chạy thử trên máy có GPU.

Trên Windows chạy `py -3.11 run.py`. `run.py` cài gói Python còn thiếu, tắt tiến trình cũ đang giữ cổng **5173**, đóng gói giao diện, rồi mở **một** tiến trình trên 5173: trang web, camera và `/api` của trợ lý nằm chung một chỗ. Hồ sơ `cpu` là tiến trình HTTPS; hồ sơ `gpu` là HTTP trên `127.0.0.1` cùng một **tunnel Cloudflare** (`cloudflared`, tải qua `downloads.json`) cho địa chỉ công khai.

- **Điện thoại, hồ sơ `cpu`:** cùng Wi-Fi, mở địa chỉ mà server in ra lúc khởi động, dạng `https://<địa-chỉ-máy>:5173` (có chữ **s**; không có HTTPS thì trình duyệt chặn camera). Mặc định **không cần khoá**. Nếu bật `VR_ACCESS=on` thì địa chỉ in ra có thêm `?key=...`, điện thoại nhớ khoá sau lần đầu; hiện lỗi `access key needed` nghĩa là điện thoại chưa có khoá. Lần đầu trình duyệt cảnh báo giấy chứng nhận tự ký: chọn tiếp tục rồi tải lại.
- **Điện thoại, hồ sơ `gpu`:** máy chủ thuê không mở cổng ra ngoài, nên `run.py` in một địa chỉ dạng `https://<tên-ngẫu-nhiên>.trycloudflare.com/?key=...`. Mở địa chỉ đó trên điện thoại ở đâu cũng được; nó là HTTPS thật (camera chạy, không có cảnh báo chứng nhận). Điện thoại nhớ khoá sau lần đầu. **Địa chỉ mới ở mỗi lần chạy** và ai có địa chỉ kèm `?key=` điều khiển được trợ lý: giữ kín. `VR_TUNNEL=off` thì không mở tunnel và trang chỉ mở được ở `http://127.0.0.1:5173` trên chính máy chạy server.
- **Lần chạy đầu cần mạng** để tải thư viện (Three.js, MediaPipe, esbuild dạng file thực thi), mô hình thị giác và mô hình trợ lý. Mọi thứ cần tải khai báo trong `downloads.json` và `vendor.json`; file có sẵn thì bỏ qua, bị ngắt thì tải tiếp, sai sha256 thì tải lại. Lần sau chạy offline.
- Mô hình trợ lý (khoảng 6 GB hồ sơ `cpu`, 16 GB hồ sơ `gpu`) nằm trong `assistant/weights/`, các chương trình chạy chúng (llama.cpp, whisper.cpp) trong `assistant/bin/`; cả hai đều không đưa vào git. Riêng giọng mẫu `assistant/voices/hino.wav` (vài giây) nằm trong git; muốn đổi giọng thì thay file này bằng một đoạn ghi âm khác, một người nói, khoảng 5 đến 8 giây, sạch tiếng ồn.

### Bảo mật

Hồ sơ `cpu` nghe trên cả mạng để điện thoại vào được; hồ sơ `gpu` chỉ nghe trên `127.0.0.1` và tunnel là đường vào duy nhất. Mà `/api` cài và chạy plugin do AI viết, dùng khoá API (nếu bạn đặt) và giữ khuôn mặt, tên của những người trợ lý biết. Vì vậy (`assistant/access.py`):

- Khoá truy cập **tắt mặc định ở hồ sơ `cpu`** (ai cùng Wi-Fi cũng dùng được trợ lý, nên chỉ dùng ở mạng tin cậy) và **bật mặc định ở hồ sơ `gpu` khi có tunnel** (tắt khi `VR_TUNNEL=off`); `VR_ACCESS=on|off` quyết định bằng tay; trang web lạ vẫn bị chặn. Khi khoá bật, trình duyệt trên **chính máy tính chạy server** không cần khoá, thiết bị khác phải gửi khoá trong header `X-Access-Key`. Khoá là `VR_ACCESS_TOKEN`, hoặc khoá ngẫu nhiên tự sinh lần chạy đầu và giữ trong `assistant/data/access.key` (không đưa vào git). **Giữ kín địa chỉ có `?key=`**: ai có nó điều khiển được trợ lý. Muốn đổi khoá thì xoá file đó rồi chạy lại.
- Yêu cầu đi qua tunnel **vẫn phải có khoá**: `cloudflared` chạy trên chính máy chủ nên yêu cầu của nó đến từ `127.0.0.1`, và chỉ nhờ header `Cf-Connecting-Ip` / `X-Forwarded-For` của Cloudflare mà nó không bị nhầm với trình duyệt trên máy chủ.
- Yêu cầu tự nhận đến từ **trang web khác** (header `Origin` không phải chính server) bị từ chối, kể cả trên máy tính, để một trang độc hại mở trong trình duyệt không điều khiển được trợ lý.
- Trang web và `/api/health` luôn mở (trang phải tải được thì mới nhận được khoá). `VR_ACCESS=off` tắt kiểm tra khoá khi mạng đáng tin; kiểm tra trang web vẫn giữ.
- Chạy sau một reverse proxy khác (không phải tunnel của `run.py`) trên cùng máy thì mọi yêu cầu trông như từ chính máy tính, trừ khi proxy đó cũng thêm `X-Forwarded-For`: đừng làm vậy mà không tự thêm lớp xác thực.

## Cách dùng

1. **Bấm dấu vân tay.** Camera mở, trang vào toàn màn hình, màn hình chia hai mắt. Lúc này chưa có menu, chưa có tay, chưa có trợ lý; micro chờ đúng cụm **"system call"**.
2. **Nói "system call"** (hoặc bấm phím `S`, xem bên dưới). Hệ thống khởi động: nhật ký khởi động chạy, theo dõi tay bật, trợ lý nạp mô hình và chào.
3. **Gọi trợ lý bằng tên "hino"**, hỏi luôn trong câu ("hino, mấy giờ rồi") hoặc gọi xong rồi hỏi. Sau mỗi câu trả lời trợ lý nghe thêm một lúc (mặc định 10 giây, chỉnh trong menu trợ lý) rồi ngủ lại.
4. **Búng tay để mở menu**, chụm ngón để bấm và kéo.

### Phím gỡ lỗi (máy tính)

| Phím | Tác dụng |
|---|---|
| `S` | Giả lập câu "system call": khởi động hệ thống không cần nói. Chỉ có tác dụng khi đang chờ "system call". |
| `M` | Giả lập cú búng tay: mở hoặc đóng menu. Bị bỏ qua lúc đang chờ hoặc đang khởi động. |

Các phím khác không làm gì. Phím cũng không chạy khi đang gõ trong ô nhập hoặc giữ Ctrl/Alt/Meta.

### Xoay đầu để lướt menu (cảm biến điện thoại)

Khi thanh danh mục của menu đang hiện, **xoay đầu sang phải** thì thanh trượt tới mục kế, **sang trái** thì về mục trước. Thanh bám theo chuyển động và chốt vào mục gần nhất sau khoảng 16°, giống như vuốt tay. Hướng được đọc từ mặt sau của điện thoại trên mặt phẳng ngang, nên không phụ thuộc điện thoại đang dọc hay ngang. Tay đang kéo thanh thì cảm biến nhường tay. Nhìn gần thẳng lên hoặc xuống thì không phản hồi. Mã ở `src/app/ImuMenu.ts`.

## Điều khiển bằng tay

Chỉ có **một** cử chỉ chạm: **chụm ngón cái và ngón trỏ**. Con trỏ nằm ở điểm giữa hai đầu ngón nên đứng yên khi chụm.

- **Buông tại chỗ là bấm.** Đưa con trỏ lên nút, chụm, nhả.
- **Giữ hoặc đi xa là kéo.** Chụm rồi đi quá 5% khung nhìn, hoặc giữ quá nửa giây, thì thành kéo (thanh trượt, thanh danh mục, vùng cuộn). Buông tại chỗ vẫn là bấm.
- **Mất dấu tay là hủy**, không phải bấm.
- **Hai tay cùng chụm rồi giang ra hoặc khép vào là phóng to hoặc thu nhỏ** thứ nằm giữa hai tay (bản đồ, cảnh 3D). Cử chỉ này nhận ra một lần trong Core (`TwoHandGesture`), gửi đi như con lăn chuột nên mọi thứ dùng được con lăn đều dùng được; sự kiện `twohand` trên bus còn có `rotation` và `pan` cho nơi nào cần xoay hay kéo. Khi bắt đầu, cú chụm riêng của từng tay bị bỏ.
- **Bàn phím ảo tự nổi lên** khi bạn chụm (hoặc chạm, bấm chuột) vào một ô chữ ở bất cứ đâu, trong menu hay trong plugin. Bàn phím của điện thoại không hiện. Bố cục như bàn phím điện thoại: hàng số ở trên, chữ ở dưới. Phím chức năng là biểu tượng (mũi tên lên là **Hoa**: bấm một lần cho một chữ, bấm lần nữa để khóa; ô vuông có dấu x là **Xóa**; khung hở dưới là **Cách**; mũi tên gập là **Xuống dòng**; mũi tên trái phải dời con trỏ; dấu tick là **Xong**; micro là **Đọc chữ**), **?123** chuyển sang ký tự (bấm **=\<** để sang trang ký tự còn lại, **ABC** để về chữ), **Xóa**, **Cách**, dấu phẩy và chấm cạnh phím cách, **Xuống dòng**, **Trái / Phải** dời con trỏ, **Xong** để cất. Phím **VI / EN** đổi cách gõ: VI là Telex (`aa` ra â, `dd` ra đ, `w` ra ư ơ ă, `s f r x j` đặt dấu), EN gõ nguyên chữ. Phím **Đọc chữ** bấm một lần để nói, bấm lần nữa để chữ được điền vào ô.
- **Búng tay** (ngón cái ép vào ngón giữa rồi ngón giữa bật xuống lòng bàn tay) **bật hoặc tắt menu.** Cử chỉ được nhận theo ba pha ép, trượt, rơi nên không nhầm với nhả chụm. Có thể tắt trong mục cử chỉ.

Tay bấm giao diện qua **một đường duy nhất** trong Core: `DomPointerSurface` tìm phần tử dưới con trỏ, `dispatchHandPointer` phát đúng các sự kiện con trỏ như chuột (`pointerdown`, `pointermove`, `pointerup`). Nên cái gì chuột làm được thì tay làm được; phần tử không phải nút cần thêm `data-hand-target`.

**Con trỏ** là khung ngắm vuông: bốn góc chữ L, một ô nhỏ ở giữa đầy dần khi giữ, một khung ngoài đứng yên khi kéo, và một khung loé ra khi bấm trúng. Nó là một lớp DOM riêng trong mỗi mắt, nằm **trên mọi thứ** (menu, bàn phím ảo, màn hình plugin) và không nhận cú bấm. Độ rõ và cỡ chỉnh trong mục **con trỏ**.

Mục **chẩn đoán** hiện một dòng chỉ số ở góc mỗi mắt: `FPS`, `FPS CAM`, `FPS HAND` và `MIC <chế độ> <mức âm>`. `MIC name check` là Hino đang ngủ và chỉ nghe tên "Hino"; `MIC model listening` là Hino đã được gọi và đang chờ câu hỏi; `MIC working` là đang trả lời. Dòng này giới hạn ở 60% bề rộng mắt nên chỉ có bấy nhiêu mục.

## Menu

Menu nằm giữa khung camera của mỗi mắt. Phần đầu là **thanh danh mục** cuộn vòng, không có mục đầu hay cuối: mỗi mục là một cái tên đặt trên một đoạn vạch nghiêng, mục đang chọn có vạch dài và sáng, hai đầu mờ dần, nằm trong một khung trong suốt màu chính. Vuốt hoặc xoay đầu để tới mục, chạm mục ở giữa để vào chi tiết.

13 mục:

| Mục | Dùng để |
|---|---|
| chế độ xem | Chuyển giữa hai mắt (stereo) và một khung |
| hướng xem | Xoay giao diện 90° (ảnh camera đứng yên); có chế độ tự xoay theo hướng cầm máy |
| thấu kính | Khoảng cách hai mắt, khe giữa, trường nhìn, cỡ khung camera, lệch tâm, độ méo `k1`/`k2`, khoảng cách giao diện, nút đặt lại |
| cử chỉ | Độ nhạy chụm ngón, ngưỡng và thời gian giữ để thành kéo, bật tắt búng tay |
| con trỏ | Độ rõ và cỡ con trỏ |
| màu | Màu chính và màu phụ (sắc, độ đậm, độ sáng, độ trong), nút đặt lại màu |
| tiện ích | Bật tắt plugin |
| trợ lý | Bật tắt trợ lý, chọn mô hình, Tải, Nói / Dừng, thử một câu chữ, giọng đọc (cao độ, tốc độ, biểu cảm, nhịp, quãng nghỉ: lần lượt là cao độ giọng, tốc độ, `temperature`, `top_p`, `silence_p` của VieNeu; mặc định 138 Hz là cao độ thật của giọng mẫu), thời gian nghe |
| luồng xử lý | FPS theo dõi tay, FPS của plugin, cỡ ảnh phân tích |
| camera | Lật ảnh camera trước |
| chẩn đoán | Khung chỉ số ở góc mỗi mắt |
| nhật ký | Mọi dòng console của phiên này (đệm 300 dòng, dòng mới ở trên, có nút xoá) |
| ngôn ngữ | Tiếng Việt hoặc English, đổi ngay cả giao diện lẫn tên plugin |

Phần lớn cài đặt cũng **chỉnh được bằng giọng nói** (xem phần trợ lý).

## Trợ lý HINO

Trợ lý là tiến trình Python trong `assistant/`, chạy trên máy tính và chung cổng 5173 với trang. Điện thoại chỉ gửi chữ hoặc một đoạn WAV và nhận chữ cùng tiếng nói về.

| Việc | Cách làm |
|---|---|
| Trả lời | Qwen3-VL 4B (cpu) hoặc 8B (gpu), llama.cpp. Câu trả lời được đọc từng câu ngay khi viết xong câu đó. Cũng là model làm menu bằng gọi công cụ và đọc ảnh chụp màn hình. |
| Nghe | whisper.cpp chép chữ: hồ sơ `cpu` một model `small` nghe cả từ gọi lẫn câu hỏi và lệnh (large-v3 q5 quá chậm trên laptop 4 nhân, xem `rules.md` E3); hồ sơ `gpu` là large-v3 q5. |
| Nói tiếng Việt | VieNeu-TTS v3 Turbo (ONNX, CPU), clone từ giọng mẫu `assistant/voices/hino.wav`. Tải về `assistant/weights/vieneu/` qua `downloads.json`, chạy cục bộ, không cần mạng. |
| Nói tiếng Anh | SAPI của Windows. |
| Từ gọi | "system call" (khởi động, `src/shared/wake.json`) và "hino" (đánh thức trợ lý, `src/shared/assistant.json`). So khớp gần đúng theo âm, bỏ dấu. |

Mỗi lượt nói ghi một dòng `time` vào log của máy chủ và vào mục **nhật ký** của trang (nghe, chữ đầu tiên, token mỗi giây, đọc mỗi câu, tổng) để biết chậm ở khâu nào; bảng "hiện thông tin model" cũng in lượt gần nhất. Giọng đọc chạy song song với model viết, từng câu theo thứ tự. Chậm ở khâu nào thì trỏ khâu đó tới máy mạnh hơn hoặc API bên ngoài bằng `VR_<KHÂU>_URL`.

Trợ lý đang nói thì micro tạm tắt để không nghe lại chính nó. Trình duyệt chỉ cắt các đoạn có tiếng theo độ to và gửi lên `/api/voice/listen`; việc nhận cụm gọi làm ở Python (`assistant/models/wake.py`).

### Điều khiển bằng giọng nói

Hai nhóm lệnh được xử lý trước khi hỏi mô hình (`assistant/models/commands.py`, `controls.py`):

- **Plugin:** "bật plugin bản đồ", "tắt plugin nhận diện khuôn mặt"; tiếng Anh cũng được.
- **Menu:** "tăng tốc độ đọc", "giảm độ rõ con trỏ", "tắt chẩn đoán", "chuyển sang tiếng Anh", "mở mục giọng đọc". Hỗ trợ số (tăng/giảm, đặt giá trị, tối đa/tối thiểu/mặc định/phần trăm), công tắc (bật/tắt), lựa chọn và mở một mục menu. Danh sách thứ chỉnh được nằm trong `src/shared/voice-controls.json`.

- **Model (`assistant/models/modelswitch.py`):** "hiện thông tin model", "model nào đang dùng", "cho tôi xem cấu hình trợ lý" mở trang Trợ lý và in bảng cấu hình (mỗi khâu chạy ở đâu, dùng model nào, kể cả khâu của plugin); "có những model nào để trả lời" đọc danh sách thật từ điểm cuối của khâu đó; "đổi model trả lời sang qwen 72b" (chỉ khi khâu trỏ tới API bên ngoài; tên được so với danh sách thật, trợ lý đọc lại tên đầy đủ và chờ bạn nói "đúng" mới đổi). Lựa chọn bằng giọng nói chỉ có hiệu lực đến khi khởi động lại server và không sửa `.env`.

### Công cụ (hẹn giờ, thời tiết, tra cứu)

Ba việc mà mô hình ngôn ngữ không biết hay không làm được, đều là lệnh theo từ khoá (`assistant/models/tools.py`), không để mô hình quyết định:

- **Hẹn giờ và nhắc việc:** "hẹn giờ năm phút", "hẹn giờ một tiếng rưỡi", "nhắc tôi tắt bếp sau mười phút", "set a timer for 5 minutes". Đồng hồ chạy ngay trong trang, nên đếm ngược không cần mạng; hết giờ trợ lý tự nói (chờ câu đang nói xong). Tối đa 24 giờ; tải lại trang thì hẹn giờ mất.
- **Thời tiết:** "thời tiết ở Đà Nẵng ngày mai", "weather in Paris". Dùng Open-Meteo (không cần khoá); không nói thành phố thì dùng **vị trí hiện tại của thiết bị** (trang đã có quyền vị trí; tọa độ làm tròn hai số lẻ, khoảng một cây số, và chỉ hai số đó được gửi đi).
- **Tra cứu:** "tra cứu Alan Turing", "look up Alan Turing". Đọc phần tóm tắt trang Wikipedia, kèm toàn văn hiện lên màn hình.

Thời tiết và tra cứu gửi tên nơi hoặc chủ đề bạn nói tới Open-Meteo và Wikipedia, và không gì khác. `VR_TOOLS=off` tắt cả hai.

### Nhìn những gì bạn đang thấy (trợ lý)

Trợ lý đọc **một ảnh chụp đúng cái bạn đang thấy**: giao diện (menu, nhật ký, chữ) vẽ lên hình camera trước mắt. Nói:

- về giao diện: "đọc lỗi trên màn hình", "màn hình này bị gì", "lỗi này là gì", "what is this error", "read the screen";
- về thứ trước camera: "cái này là gì", "đây là con gì", "đọc chữ trên biển", "đọc thực đơn", "dịch cái này", "what is this", "translate this menu".

Trợ lý nói ngay một câu đáp ngắn (mặc định "Dạ sếp", sửa ở menu trợ lý, ô "Câu đáp khi nhờ xem"), trang chụp ảnh và gửi tới `POST /api/assistant/screen` (khâu `vision`, chính model trả lời Qwen3-VL), rồi đọc một đoạn ngắn và hiện **toàn bộ** câu trả lời lên trang Trợ lý. "Tôi đang thấy gì" và "đọc mã QR" vẫn là của plugin **Mô tả cảnh** và **Đọc mã** (chạy trên trình duyệt, không gọi model).

Ảnh do `src/core/screen/ScreenCapture.ts` chụp: lấy khung hình camera hiện tại đặt vào ô vuông mà mắt đầu tiên hiển thị (lật gương nếu trang đang lật và xoay theo `viewTurn` nếu giao diện đang xoay), rồi chép tài liệu, cho trình duyệt vẽ giao diện vào ảnh SVG và phủ lên trên, cắt lấy **một mắt**. Không xin quyền, chạy được trên điện thoại (`getDisplayMedia` thì không). Ảnh chỉ được chụp khi bạn hỏi, gửi qua đường có khoá truy cập, không được lưu.

Plugin **Hỏi về hình ảnh** (`vision-ask`) đã bỏ; việc của nó giờ là của trợ lý.

### Ghi chú và việc cần làm

Lưu trong `assistant/data/notes.json` (không đưa vào git), không qua mô hình: "ghi nhớ mua sữa", "remember to call mom", "đọc ghi chú" (đọc vài mục đầu, hiện đủ trên màn hình), "xong việc số hai", "xóa ghi chú số ba", "xóa hết ghi chú" (hỏi lại, chờ "đúng"). Tối đa 200 mục.

### Ngắt lời bằng giọng

Mục **trợ lý** có công tắc **Ngắt lời bằng giọng** (mặc định tắt). Bật lên thì mic vẫn mở lúc trợ lý đang nói, và một câu chỉ gồm "dừng lại", "im đi", "thôi" hay "stop" làm nó ngừng ngay (câu dài hơn ba giây không được kiểm tra). Mỗi đoạn tiếng nghe được lúc đó chạy một lần Whisper nhỏ trên máy, và tiếng loa lọt vào mic bị nghe lại, nên nên dùng tai nghe.

### Trợ lý viết plugin

Nói "tạo plugin đếm số người" rồi mô tả: trợ lý viết một bản nháp vào `plugins-pending/` (kiểm tra mã, biên dịch, **chưa cài**). Bạn nói "duyệt plugin …" để cài (server dựng lại, trang tự nạp lại, **không cần chạy lại server**) hoặc "từ chối plugin …" để bỏ. Plugin do trợ lý viết (id `ai-…`) được cấp **mọi quyền** mà nó xin: `network`, `screen`, `snapshot`; bản nháp ghi rõ quyền nó dùng trong `manifest.ts`. Các bước kiểm tra chỉ là lưới đỡ lỗi chứ không phải hộp cát (chỉ cấm `eval`, `Function`, `import()`), nên bạn nên đọc thư mục nháp trước khi duyệt.

**Sửa plugin có sẵn bằng giọng nói:** "sửa plugin bản đồ, thêm nút phóng to" (hoặc "fix the 3D map plugin so …"). Trợ lý đọc các file của plugin (tối đa 60.000 ký tự, không đụng `models.json` và `vendor.json`), viết lại những file cần đổi và để chúng chờ trong `plugins-pending/<id>--edit/`. Nói "duyệt plugin …" thì bản gốc được sao lưu vào `plugins-backup/`, file mới được ghi, server dựng lại và trang nạp lại; dựng lỗi thì mọi thứ trả về như cũ. Chất lượng phụ thuộc vào model của khâu `code`.

Chất lượng phụ thuộc vào người viết: khâu `code` mặc định là Qwen2.5-Coder 3B chạy trên CPU; muốn model mạnh hơn thì đặt `VR_CODE_URL`, `VR_CODE_KEY`, `VR_CODE_MODEL` (xem **Một cấu hình cho mọi AI**).

### Một cấu hình cho mọi AI (`assistant/ai/`)

Mọi lời gọi AI đi qua **một client** (`assistant/ai/client.py`) và **một file cấu hình** (`assistant/ai/stages.cpu.json` hoặc `stages.gpu.json`, theo `VR_PROFILE`). Mỗi việc cần AI là một **khâu**, và khâu chỉ là `url`, `key`, `model`:

| Phía | Khâu | Mặc định (`cpu` / `gpu`) |
|---|---|---|
| Trợ lý | `chat` (trả lời) | llama.cpp: Qwen3-VL 4B, cổng 8081, ngữ cảnh 4096, ảnh tối đa 400 token / Qwen3-VL 8B, cổng 8081, ngữ cảnh 16384 |
| | `agent` (làm menu bằng gọi công cụ), `vision` (ảnh chụp màn hình) | theo `chat` |
| | `code` (viết, sửa plugin) | llama.cpp: Qwen2.5-Coder 3B / 14B, cổng 8082, **nạp khi cần** và tắt sau 3 phút không dùng |
| | `stt` (nghe câu hỏi và lệnh) | whisper.cpp small, cổng 8084, chung máy chủ với `stt_wake` / large-v3 q5, cổng 8083 |
| | `stt_wake` (nghe từ gọi "hino" và "dừng", chạy trên mọi câu mic cắt ra) | `cpu`: cùng whisper small, cổng 8084; `gpu`: theo `stt` (có thể đặt model nhẹ hơn riêng cho nó) |
| | `tts` (nói) | VieNeu (tiếng Việt) và SAPI (tiếng Anh), chạy trong tiến trình |
| Plugin | `plugin_chat` (`POST /api/plugin-ai/chat`) | theo `chat`, nhưng là khâu riêng |

Trợ lý và plugin tách bạch: plugin không bao giờ chạm tới khâu của trợ lý, và đổi địa chỉ của `plugin_*` không ảnh hưởng Hino.

**Muốn dùng API bên ngoài cho một việc**, đặt trong `assistant/.env` (không sửa code, không sửa JSON):

```
VR_CHAT_URL=https://api.example.com/v1
VR_CHAT_KEY=...
VR_CHAT_MODEL=ten-model
```

`<KHÂU>` là `CHAT`, `AGENT`, `VISION`, `CODE`, `STT`, `STT_WAKE`, `TTS`, `PLUGIN_CHAT`. Khâu nào có `use` thì theo khâu kia: đặt `VR_CHAT_URL` là chuyển cả `agent`, `vision`, `plugin_chat` đi theo; đặt `VR_AGENT_URL` riêng thì tách `agent` ra. Điểm cuối cần nói giao thức OpenAI (`/chat/completions`, `/audio/transcriptions`, `/audio/speech`, `/models`). Khâu `tts` không có `VR_TTS_URL` thì dùng giọng trong tiến trình.

**Máy chủ AI trên máy** (`servers` trong `stages.<hồ sơ>.json`): llama.cpp và whisper.cpp là chương trình thường, `run.py` tải về `assistant/bin/` cùng model vào `assistant/weights/` (`downloads.json`, khoảng 6 GB lần đầu), rồi server Python khởi chạy chúng và tắt cùng nó (`assistant/ai/servers.py`). Hồ sơ `cpu` (thử trên laptop i7-8665U 4 nhân, 16 GB RAM) dùng bản CPU của llama.cpp và whisper.cpp và model nhỏ; máy chủ viết mã chỉ chạy khi cần. Hồ sơ `gpu` dùng bản CUDA (llama.cpp 13.5, whisper.cpp 12.4; whisper tự chạy bằng CPU nếu card không nhận) và hai model llama cùng `group: "gpu"` vì không vừa chung 16 GB VRAM: viết plugin thì máy chủ 8B được tắt nhường chỗ, và bật lại ở câu hỏi kế tiếp. Log của từng máy chủ nằm ở `assistant/data/logs/`.

**Không còn "nguồn local/api" để đổi bằng giọng nói, và không còn dự phòng.** Một khâu lỗi thì báo lỗi rõ (tên khâu, địa chỉ), không tự chuyển sang nơi khác. Nói "hiện thông tin model" để xem từng khâu đang dùng gì; "đổi model trả lời sang …" chỉ áp dụng cho khâu đang trỏ tới API bên ngoài (khâu chạy trên máy chỉ có đúng model đã nạp).

### Cấu hình trợ lý

Biến môi trường (đặt trong `assistant/.env`, mẫu ở `assistant/.env.example`): `VR_<KHÂU>_URL`, `VR_<KHÂU>_KEY`, `VR_<KHÂU>_MODEL` (xem trên), `VR_TTS_VOICE`, `VR_VOICE_VI_PATH` (thư mục giọng đọc, có `turbo/` và `codec/`), `VR_TOOLS`, `VR_ACCESS_TOKEN`, `VR_ACCESS`. Tên gọi sửa ở `src/shared/assistant.json`; khoảng giá trị và mặc định của giọng đọc ở `src/shared/voice.json`.

API của trợ lý: `/api/health`, `/api/models`, `/api/models/{id}` (+ `load`, `complete`, `wake`, `talk`), `/api/plugins/pending`, `/api/plugins/draft`, `/api/plugins/{id}/approve|reject`, `/api/plugin-ai/chat` (cho plugin), `/api/assistant/screen` (ảnh chụp màn hình), `/api/voice/preview`, `/api/voice/listen`, `/api/voice/dictate` (giọng thành chữ cho phím Đọc chữ), `/api/people` (người đã lưu, xem mục Nhận diện khuôn mặt).

## Plugin có sẵn

Mỗi plugin là một thư mục trong `src/modules/`, chỉ tải khi bật.

| Plugin | Làm gì |
|---|---|
| **Phát hiện người** (`person-detection`) | Khoanh người trong khung hình. |
| **Nhận diện khuôn mặt** (`face-recognition`) | Khoanh mặt trong tầm khoảng 2 mét và cho biết đó là ai. Người đã lưu thì **tên, năm sinh và thông tin hiện ngay cạnh mặt**; người chưa lưu ghi "Chưa biết". Xem mục bên dưới. |
| **Quét đồ vật** (`object-detection`) | Gọi tên khoảng 80 loại đồ vật thường gặp (EfficientDet-Lite0 int8, 4,4 MB). |
| **Mô tả cảnh** (`scene-description`) | Nói cho bạn nghe trước mặt có gì. Không vẽ khung. Xem mục **Nhìn bằng giọng nói**. |
| **Đọc mã** (`code-reader`) | Đọc mã QR và mã vạch, ghi nội dung lên hình. Xem mục **Nhìn bằng giọng nói**. |
| **Bản đồ 3D** (`map3d`) | Màn hình riêng, xem bên dưới. |

### Nhận diện khuôn mặt

Mỗi khuôn mặt được biến thành **128 con số** (SFace, chạy ngay trong trình duyệt bằng onnxruntime-web; BlazeFace tìm mặt và mắt mũi miệng để căn thẳng mặt trước). Hai ảnh của một người cho các số gần nhau (độ giống cosine từ 0,4 trở lên thì coi là cùng người), hai người khác nhau thì xa nhau. **Ảnh mặt không được lưu**, chỉ lưu các con số, cùng tên, năm sinh và một ô thông tin, trong `assistant/data/people.json` trên máy chạy Hino (không đưa vào git), nên đóng trang cũng không mất.

- **Màn hình của plugin:** một thẻ nhỏ phía dưới khung camera. Người đã lưu thì tên, năm sinh và thông tin hiện ngay cạnh mặt, thẻ có **Thêm mẫu** (ghi thêm một lần nhìn để nhận ra chắc hơn) và **Danh sách**. Với người lạ có nút **Lưu người này**: điền **Tên**, **Năm sinh**, **Thông tin** (bàn phím ảo tự hiện) rồi **Lưu**. **Danh sách** xem, sửa và xóa mọi người.
- **Bằng giọng nói:** "Hino, lưu người này, tên là Nam, sinh năm 1990, thông tin: bạn đại học". Có thể nói từng phần ("người này sinh năm 1990", rồi "thông tin người này là hàng xóm"); người lạ cần có tên mới được lưu, phần đã nói được giữ 90 giây chờ phần còn lại. Người đã lưu thì lệnh sửa chính người đó. Tiếng Anh cũng được ("save this person, name John, born 1980, info neighbour").
- **API:** `GET/POST /api/people`, `PATCH/DELETE /api/people/{id}`, `POST /api/people/{id}/samples`.

Các plugin nhận diện chạy trong worker, trả về hộp và nhãn cho Core; **Core vẽ khung kèm nhãn lên camera** (trên mặt phẳng video nên hai mắt luôn khớp).

### Nhìn bằng giọng nói

Hai plugin trả lời bằng lời, qua cùng đường với lệnh lưu người (`VisionModule.command`):

- **Mô tả cảnh:** "Hino, tôi đang thấy gì?", "xung quanh có gì?", "mô tả cảnh trước mặt" (tiếng Anh: "what do I see?", "describe the scene"). Plugin tự chạy bộ nhận đồ vật riêng (EfficientDet-Lite0, có cả người), gom kết quả trong khoảng 2,5 giây gần nhất rồi nói, ví dụ "Tôi thấy hai người, một cốc và một laptop."
- **Đọc mã:** "Hino, đọc mã", "quét mã QR" ("read the QR code"). Mã QR và mã vạch (EAN, UPC, Code 128, Data Matrix…) được khoanh kèm nội dung ngay trên hình; câu nói đọc lên mã đang nhìn thấy. Bộ giải mã là zxing-wasm, khai trong `models.json` của plugin.

Plugin đang tắt thì Hino nói "Hãy bật tiện ích … trước".

### Bản đồ 3D

Hai bước:

1. **Chọn vùng trên bản đồ.** Bản đồ Leaflet (ô bản đồ từ máy chủ OpenStreetMap Đức). Kéo một tay (hoặc chuột, hoặc ngón) để di chuyển. **Chọn vùng:** chụm hai tay (mỗi tay ngón cái và ngón trỏ, tức bốn ngón) rồi kéo hai tay ra xa nhau; vùng là hình chữ nhật có hai góc là chỗ hai tay chụm, mở tay là xong. **Thu phóng** cũng bằng hai tay: chụm hai tay **cách xa nhau** từ đầu (trên khoảng 16% khung hình) rồi giang ra là phóng to, khép vào là thu nhỏ, quanh điểm nằm giữa hai tay. Chụm sát thì vẽ vùng, chụm xa thì thu phóng: chỗ hai tay chụm lúc đầu quyết định. Dùng chuột thì giữ **Shift** và kéo để vẽ vùng, con lăn để thu phóng. Chọn lại bằng cách vẽ lại: vùng mới thay vùng cũ. **Mỗi lần mở plugin bản đồ tự nhảy tới vị trí của thiết bị** (cần cho phép định vị); biểu tượng ngắm tròn trong hàng nút phía trên là nút bay về lại vị trí đó khi bạn đã kéo bản đồ đi chỗ khác, nút chuyển đỏ nếu không định vị được. Hàng nút phía trên (Đóng, Quay lại, Bước tiếp, định vị) nằm gọn ở giữa, không che bản đồ. Bước này nằm trong khung camera vuông.
2. **Thành phố 3D.** Bấm Bước tiếp: tải toà nhà và đường phố của vùng (API OpenStreetMap; nếu mạng chặn thì ô vector OpenFreeMap, cuối cùng là Overpass), dựng thành cảnh 3D lấp đầy cả mắt, tự đặt camera vào tâm cụm nhà. Đường phố được tải cho cả vòng tròn bao quanh vùng chọn.

Trong cảnh 3D, tay làm việc với cái nó nắm vào.

| Nắm vào | Một tay chụm rồi kéo | Hai tay cùng chụm |
|---|---|---|
| **Cảnh** (chỗ không có nhà) | Trượt cả khu vực | Giang ra hoặc khép vào là thu phóng, vặn tay là xoay quanh tâm, nâng hoặc hạ cả hai tay là nghiêng góc nhìn |
| **Nhà** | Nhà đó được chọn, kéo lên xuống đổi chiều cao, trái phải đổi bề rộng | Dời ngôi nhà nằm giữa hai tay trên mặt đất |

Chụm vào một tòa nhà để chọn; tòa được chọn **sáng lên như khi rê chuột**. Với chuột và cảm ứng: kéo để xoay, lăn để phóng, kéo tòa đã chọn để dời, hai ngón để đổi cỡ.

Nếu bản đồ trống hoặc không tải được toà nhà: một số mạng chặn các dịch vụ của OpenStreetMap (DNS trả `tile.openstreetmap.org` về `127.0.0.1`). Ô bản đồ lấy từ `openstreetmap.de` và toà nhà có đường dự phòng OpenFreeMap, nhưng đổi DNS máy hoặc router sang `1.1.1.1` / `8.8.8.8`, hoặc đổi mạng, vẫn là cách chắc nhất.

Plugin cần mạng (`network`): gửi vùng bạn chọn tới OpenStreetMap, tải ô bản đồ từ openstreetmap.de và phông Pretendard từ jsDelivr. Không có khung camera nào rời máy.

## Giao diện

Ràng buộc bắt buộc, có test kiểm tra:

- Mọi lớp giao diện **bán trong suốt**; camera luôn nhìn thấy.
- **Một màu chính** (và một màu nhấn). Đổi bằng mục màu hoặc `src/ui/theme.ts`; DOM và cảnh 3D dùng chung nên không lệch.
- **Mọi thứ vuông góc**, không bo, không hình tròn.
- **Không icon, emoji hay ảnh**; thanh cuộn và công tắc dựng lại bằng khối vuông.
- Chuyển động tắt được khi người dùng chọn giảm chuyển động.

**Nhật ký khởi động** là các dòng console chạy lướt trên ảnh camera (tên dịch vụ kiểu Linux, chữ tiếng Anh giữ nguyên) cùng các mốc thật (camera, tay, trợ lý, giọng, sẵn sàng) in thành dòng riêng.

**Song ngữ Việt/Anh.** Toàn bộ câu chữ nằm trong `src/i18n/text.json` (plugin có `text.json` riêng trong thư mục của nó); mã nguồn chỉ gọi bằng khoá. Test giữ cho không file `.ts` nào chứa chữ tiếng Việt và mỗi câu có đủ hai ngôn ngữ.

**Hai mắt luôn giống nhau.** Giao diện vẽ một bản cho mỗi mắt, cả hai đọc cùng một nguồn trạng thái (`SharedUiStore`, `core/sync`); hình học mắt chỉ có một nguồn (`StereoLayout`). Nội dung có đồng hồ riêng như canvas hay video chỉ giải mã hoặc vẽ **một lần** rồi chép sang từng mắt. Trang web bên thứ ba nhúng thì tự về một khung (không thể đồng bộ hai iframe). Quy tắc đầy đủ ở `rules.md`.

**Mọi thứ nằm trong khung camera.** Quy tắc tuyệt đối: mọi thứ được vẽ (giao diện, plugin, cảnh 3D của bản đồ) đều nằm gọn trong hình vuông camera của mỗi mắt (`.camera-frame`) và bị cắt ở mép khung, không bao giờ tràn ra ngoài. Cờ `fillFrame` còn trong store nhưng luôn là `false`: `setFillFrame` bị từ chối.

## Kiến trúc

```
camera → FrameHub ─┬→ HandTracking → làm mượt → GestureStateMachine → InteractionManager → menu / plugin
                   └→ ModuleManager → plugin (worker, MediaPipe) → DetectionBatch → OverlayRenderer
                                         StereoRenderer vẽ scene hai lần (mắt trái, mắt phải)

micro / giao diện ──HTTPS (tự ký hoặc tunnel) /api──► Python :5173 (trang + VieNeu) ──HTTP──► llama.cpp, whisper.cpp
```

| Đường dẫn | Nội dung |
|---|---|
| `src/app` | Khởi tạo ứng dụng, phím gỡ lỗi (`debugKeys.ts`), cảm biến lướt menu (`ImuMenu.ts`) |
| `src/core/camera` | `CameraController` (chủ duy nhất của `getUserMedia`), `FrameHub`, `FrameScheduler` |
| `src/core/rendering` | `StereoLayout`, `StereoRenderer`, `CursorLayer`, `OverlayRenderer`, `LensDistortionPass`, `CoordinateMapper` (nơi duy nhất tính toạ độ) |
| `src/core/input` | Theo dõi tay, lọc, nhận cử chỉ (chụm, búng tay, hai tay), state machine, `DomPointerSurface` |
| `src/core/models` | Cầu HTTP tới trợ lý (`ModelClient`, `ModelBridge`), `WakeController`, `VoiceControls` |
| `src/core/audio` | Thu micro, phát giọng nói, nghe từ gọi |
| `src/core/modules` | Hợp đồng plugin, `ModuleManager`, quyền, `ModuleScreenHost` (màn hình riêng của plugin) |
| `src/core/sync` | `SharedState`, `CopySync`, `CanvasMirror`, `frameClock`: mọi cơ chế giữ hai mắt giống nhau |
| `src/core/media` | Video và nội dung nhúng |
| `src/core/view` | Toàn màn hình, xoay giao diện, tự xoay theo hướng cầm máy |
| `src/ui` | Màu (`theme.ts`), stylesheet, thanh danh mục, panel menu, nhật ký khởi động |
| `src/modules/*` | Một thư mục một plugin |
| `src/shared` | Hợp đồng dùng chung, `assistant.json`, `wake.json`, `voice.json`, `voice-controls.json` |
| `src/i18n` | `text.json` và lớp gắn kiểu |
| `assistant/` | Tiến trình Python: trang + `/api`, VieNeu, lệnh giọng nói, viết plugin; `assistant/ai/` là cấu hình và client chung cho mọi AI, và khởi chạy llama.cpp, whisper.cpp |
| `run.py` | Khởi động; `downloads.json`, `vendor.json` ghim những gì cần tải |
| `public/` | Mô hình thị giác, WASM, JS đã đóng gói; sinh ra nên không nằm trong git |
| `rules.md` | Quy tắc bắt buộc cho Core, trợ lý và máy chủ |
| `src/modules/PLUGIN_RULES.md` | Quy tắc viết một plugin: file trợ lý đọc mỗi lần viết hoặc sửa plugin |

Quyết định đáng nhớ: một `CoordinateMapper` duy nhất; overlay là con của mặt phẳng video nên hai mắt tự có thị sai đúng; hàng đợi mỗi bên nhận độ sâu 1 (khung mới thay khung cũ); kết quả plugin đi qua Zod và phải khớp `sourceFrameId`; plugin không khai báo màu (hiển thị thuộc về Core); không gọi CDN công cộng lúc chạy (nhân WASM chép từ `vendor/` để không lệch phiên bản với JS, mô hình ghim SHA-256).

## Viết một plugin mới

Một plugin là **một thư mục** `src/modules/<id>/` có `plugin.ts`; không sửa file nào khác. Core quét `src/modules/*/plugin.ts`.

```ts
import { definePlugin } from "@/core/modules/definePlugin";
import { myManifest } from "./manifest";

export default definePlugin({
  manifest: myManifest,
  load: async () => (await import("./MyModule")).createMyModule(),
});
```

- Chữ của plugin ở `text.json` trong thư mục, đủ cả hai ngôn ngữ.
- Plugin dùng mô hình trong worker thì dùng `createDetectorModule` của Core; mô hình khai trong `models.json` dưới `files[]` (`file`, `url`, `sha256`), tải vào `src/modules/<id>/models/`. Thư viện riêng ghim ở `vendor.json` trong thư mục plugin. Một mô hình GGUF cho trợ lý thì khai `slots[]`.
- Module **không** được gọi `getUserMedia`, đụng DOM hay tự vẽ lớp phủ; chỉ trả hộp chuẩn hoá `0..1`.
- Plugin là cả một ứng dụng (như bản đồ) xin quyền `screen` và gọi `context.screen.show(view)`; Core gọi `view` một lần cho mỗi mắt, nên mọi bản phải vẽ từ một trạng thái chung.
- Quyền `network`, `snapshot`, `screen` phải do người ghi tay vào `src/core/modules/permissions.ts`; manifest không tự cấp cho mình được.

## Quyền riêng tư

- Camera chỉ mở sau cú bấm dấu vân tay.
- Khung hình **không rời máy** và không được lưu. Telemetry chỉ là số liệu tổng hợp, đi qua `redactRecord`.
- Mô hình thị giác chạy trong trình duyệt từ `public/`; trợ lý chạy trên máy tính của bạn.
- Ngoại lệ có ghi quyền: `map3d` gọi OpenStreetMap, openstreetmap.de (ô bản đồ), Overpass và jsDelivr (xem trên). Khâu nào bạn trỏ tới API bên ngoài (`VR_<KHÂU>_URL`) thì gửi dữ liệu của khâu đó (câu hỏi, đoạn âm thanh, ảnh chụp màn hình, mô tả plugin) tới địa chỉ bạn đặt; mặc định không khâu nào ra ngoài máy.
- Mã trợ lý viết ra chỉ chạy sau khi bạn duyệt.

## Kiểm thử

```bash
python run.py test
```

Chạy các test trong `test/` (camera, khung vuông, giao diện một màu và vuông góc, song ngữ, hai mắt, thấu kính, plugin, lệnh giọng nói, trợ lý viết plugin, tải về, bàn phím ảo, cử chỉ hai tay, lưu người bằng giọng nói, nhận diện mặt, không dùng Node...). Test chạy bằng Python, không cần Node.

## Hướng phát triển

Nhận biển số và OCR, giao diện hiệu chỉnh kính chi tiết hơn, kiểm thử hình ảnh tự động, WebXR immersive (`XRHand`), plugin nhận diện chạy trên máy chủ.
