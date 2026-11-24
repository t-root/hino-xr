# code-reader: đọc mã QR và mã vạch

Ghi chú thiết kế của riêng plugin này (trước đây ở `rules.md`, mục M3). Quy tắc chung cho mọi plugin ở `../PLUGIN_RULES.md`.

**M3.** `code-reader` nạp zxing-wasm bằng bản iife và `importScripts`, còn lõi wasm tìm bằng `locateFile` trỏ vào thư mục
plugin; cả hai khai trong `models.json` (có sha256) và không có địa chỉ ngoài trong worker (`PLUGIN_RULES.md` §1). Hộp mã đặt
`attributes.plainLabel` để nhãn là nội dung mã, không có phần trăm.
