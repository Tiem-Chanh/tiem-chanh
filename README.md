# Tiệm Chanh

Ứng dụng đọc truyện với giao diện độc giả và trang quản trị dành cho một chủ sở hữu. Bản sửa đối chiếu mã nguồn gốc `0c93ad8` với nội dung và ảnh tham khảo trong tài liệu `web.docx`.

## Chạy trên máy

Cần Node.js 22 trở lên. Không có thư viện npm bắt buộc và không cần chạy `npm install`.

```powershell
cd duong-dan-den-thu-muc-tiem-chanh
node server.mjs
```

Mở `http://127.0.0.1:3000`. Có thể dùng `npm start` thay cho `node server.mjs`.

Không mở trực tiếp `index.html` bằng `file://`. Bản này dùng API Node để đọc truyện và quản lý nội dung, nên không thể triển khai riêng các tệp tĩnh lên GitHub Pages.

## Bật quản trị

Đặt `ADMIN_PASSWORD` bằng mật khẩu riêng có 12–256 ký tự trước khi chạy máy chủ. Tên tài khoản mặc định là `owner`; thay đổi bằng `ADMIN_USER`.

```powershell
$env:ADMIN_USER = 'owner'
$env:ADMIN_PASSWORD = Read-Host 'Nhap mat khau quan tri rieng tu 12 ky tu'
node server.mjs
```

Mở `http://127.0.0.1:3000/admin` và đăng nhập. Không có mật khẩu quản trị mặc định. Khi chưa đặt mật khẩu, website độc giả vẫn chạy và chức năng đăng nhập quản trị bị vô hiệu hóa.

Có thể sao chép `.env.example` thành `.env`, điền cấu hình và chạy `node --env-file=.env server.mjs`. Không đưa `.env` lên Git. `npm start` không tự đọc `.env`.

## Chức năng đã sửa và bổ sung

- Thanh đầu trang chỉ hiển thị logo Chanh, phóng lớn phần logo và xử lý khoảng trong suốt của ảnh gốc bằng CSS.
- Trang chủ bỏ banner và góc yêu thích cá nhân; lần lượt hiển thị Truyện được yêu thích, Truyện đang hot và Tất cả truyện. Dùng đúng hai icon BXH trong repo. Hai danh sách được sắp xếp theo số yêu thích và tổng lượt đọc.
- BXH độc giả, ví Chanh và vườn chỉ có trên trang chủ. Nhà giữ hồ sơ và hai bộ sưu tập avatar/khung avatar; bỏ lịch sử xu.
- Vườn có một ô, ba cấp giống, số lần tưới tăng theo cấp, khoảng nghỉ giữa hai lần tưới là một phút, thưởng thu hoạch ngẫu nhiên. Cây từ năm ô cũ được đưa vào hàng chờ, không bị xóa khi nâng cấp.
- Túi mua hàng có các danh sách đang đọc, đã đọc, yêu thích. Lưu chương và vị trí cuộn; tiếp tục đọc sau khi đổi trang hoặc tải lại. Điều hướng dựa trên chương đã công khai, kể cả khi số chương không liên tiếp.
- Khám phá bỏ hai dòng mô tả được nêu trong tài liệu và giữ chức năng ghi chú cá nhân.
- Trang quản trị có pop-in tạo/sửa/ẩn/xóa truyện và chương, thêm tác giả, thể loại, tóm tắt, nguồn gốc, thẻ và ảnh bìa. Hỗ trợ hẹn giờ đăng và bản nháp.
- Soạn chương theo từng đoạn, định dạng đậm/nghiêng/gạch chân, căn trái/giữa/phải/đều, xem trước và nhập TXT UTF-8. Nội dung được lưu thành văn bản và thuộc tính định dạng, không chèn HTML tùy ý.
- Tải ảnh avatar, khung, emoji và bìa; xem ảnh gốc và vùng avatar tròn trước khi lưu. Avatar/khung tải lên xuất hiện trong cửa hàng; emoji dùng trong bình luận.
- Dữ liệu truyện và tệp tải lên được lưu phía máy chủ. Ẩn truyện/chương hoặc hẹn giờ chưa đến hạn cũng chặn API đọc trực tiếp.
- Sửa lỗi avatar bị ẩn ở màn hình nhỏ, tính thời gian hoạt động bị mất phần lẻ, dữ liệu localStorage hỏng gây lỗi trang và chèn HTML qua dữ liệu truyện.

## Quản lý nội dung

Truyện ban đầu được đánh dấu **Truyện mẫu** để giữ khả năng xem thử của repo cũ. Lượt đọc ban đầu là số minh họa từ mã nguồn gốc, không phải thống kê người đọc thật. Mỗi truyện mẫu có nội dung chương mẫu; hãy tạo truyện mới trong quản trị để đăng nội dung thật. Có thể ẩn hoặc xóa các truyện mẫu.

Số chương do quản trị viên nhập là định danh chương. Khi ẩn hoặc xóa một chương, hệ thống không đánh lại số những chương còn lại. Một lượt đọc được tính khi tải thành công một chương; cùng trình duyệt đọc lại cùng chương trong ngày UTC không làm tăng tiếp. Yêu thích được tính một lần cho mỗi cookie độc giả và có thể bỏ yêu thích. Đây là nhận dạng trình duyệt ẩn danh, chưa phải tài khoản cá nhân xác minh.

Hẹn giờ dùng thời điểm trên thiết bị nhập và lưu theo ISO/UTC. API chỉ công khai chương sau thời điểm này; độc giả đang mở trang cần tải lại để lấy mục lục mới.

Ảnh nhận PNG/JPEG/GIF/WebP, tối đa 2 MB; trình soạn kiểm tra khả năng đọc ảnh và giới hạn mỗi chiều 4096 px. Tệp SVG không được nhận. Khung trong suốt có tỷ lệ vuông thường phù hợp nhất với vùng xem trước tròn.

## Dữ liệu và triển khai

Mặc định dữ liệu riêng nằm trong `.data/catalog.json` và `.data/uploads/`, được tạo khi chạy. Cấu hình `DATA_DIR` để đổi nơi lưu; giữ thư mục này trên ổ lưu bền vững và sao lưu trước khi cập nhật. Thư mục mẫu `data/` chỉ dùng khởi tạo lần đầu. `.data`, `.env` và dữ liệu Git không được phục vụ công khai.

Máy chủ mặc định chỉ nghe trên `127.0.0.1:3000`. Khi triển khai lên một máy chủ Node, đặt `HOST`, `PORT` và `PUBLIC_ORIGIN`, ví dụ `PUBLIC_ORIGIN=https://ten-mien-cua-ban.vn` (không có dấu `/` cuối). Dùng HTTPS ở reverse proxy; khi origin là HTTPS, cookie quản trị có cờ Secure. Dịch vụ hiện dùng tệp JSON và phiên trong bộ nhớ, phù hợp một tiến trình Node; khởi động lại sẽ đăng xuất các phiên quản trị. Không chạy nhiều tiến trình cùng ghi một thư mục dữ liệu.

Quản trị dùng kiểm tra mật khẩu bằng scrypt và so sánh thời gian cố định, cookie HttpOnly/SameSite, hạn dùng phiên, giới hạn thử đăng nhập và kiểm tra Origin cho thao tác ghi. Không đặt mật khẩu hay khóa bí mật trong mã JavaScript trình duyệt.

## Giới hạn hiện tại

- Repo được cung cấp chỉ có logo, xu, icon và GIF. Chưa có bộ sprite/tài nguyên game được nhắc trong tài liệu. Cây đang dùng hình CSS; thông số trong `core.mjs` là cấu hình thử có thể điều chỉnh.
- Hồ sơ độc giả, xu, vật phẩm, vườn, tiến độ, ghi chú và bình luận vẫn nằm trong localStorage của thiết bị. Chưa có đăng nhập độc giả, đồng bộ nhiều thiết bị hoặc chống sửa xu qua DevTools. BXH độc giả vẫn là minh họa và được ghi rõ trên giao diện. Ghi chú/bình luận chưa chia sẻ giữa các độc giả.
- Sao chép/cắt/dán, chọn chữ, kéo nội dung và chuột phải bị hạn chế trong vùng nội dung truyện; ô nhập liệu và trang quản trị vẫn dùng bình thường. Không có API xuất EPUB/PDF/TXT và nội dung truyện bị ẩn khi in. Trình duyệt vẫn phải nhận nội dung để hiển thị, nên các biện pháp này không thể ngăn tuyệt đối DevTools, ảnh chụp màn hình, OCR hay công cụ chuyển EPUB.
- Chưa nhập trực tiếp DOCX vào trình soạn chương. Có thể dán nội dung hoặc nhập TXT. Đây không phải hệ thống chống sao chép hay quản lý tài khoản độc giả hoàn chỉnh.

## Kiểm tra

```powershell
npm run check
npm test
```

Các kiểm tra tự động dùng `node:test`, không cần cài thư viện. Bao gồm logic cây, di chuyển dữ liệu cũ, xếp hạng, xác thực và phân quyền, ẩn/hẹn giờ chương, ghi bền dữ liệu, tải ảnh, đếm lượt đọc/yêu thích và đăng xuất.

Bản sửa cũng đã được kiểm tra bằng Chrome: tạo truyện/chương, định dạng, upload và trang bị avatar/khung, emoji bình luận, nhớ tiến độ đọc qua tải lại, tưới/thu hoạch và bố cục 320/390/768/1024/1440 px.
