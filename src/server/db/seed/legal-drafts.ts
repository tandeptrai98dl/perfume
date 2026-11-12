import type { docFromBlocks } from '@/lib/rich-text';

/**
 * Draft legal pages (vi + en) for the policies route (§5.1, §1.5): returns (D17), shipping
 * (D18), payment (D16), privacy (PDPL 91/2025, Decree 356/2025), terms (E-commerce Law
 * 122/2025) and cookies. DB content, so Vietnamese text is allowed here (ADR-0003).
 *
 * Every page opens with a visible "draft pending lawyer review" notice: the go-live gate
 * (§15) requires the lawyer to approve the wording; staff then edit the pages in
 * admin → Content → Pages and remove the notice. The Vietnamese version prevails (§3.6).
 */

type Blocks = Parameters<typeof docFromBlocks>[0];
export type LegalPageSeed = {
  key: string;
  vi: { title: string; slug: string; description: string; blocks: Blocks };
  en: { title: string; slug: string; description: string; blocks: Blocks; published: boolean };
};

const VI_DRAFT = {
  p: 'BẢN NHÁP — văn bản đang chờ luật sư rà soát, chưa phải bản chính thức. Nội dung có thể thay đổi trước khi website chính thức bán hàng.',
};
const EN_DRAFT = {
  p: 'DRAFT — this text is awaiting review by our lawyer and is not final. It may change before the store officially opens. If the Vietnamese and English versions differ, the Vietnamese version prevails.',
};

/** Processors outside Vietnam that receive personal data (§1.5 cross-border transfers). */
const VI_PROCESSORS = [
  'Cloudflare (bảo mật và phân phối nội dung, Hoa Kỳ): địa chỉ IP và dữ liệu truy cập.',
  'Nhà cung cấp dịch vụ email giao dịch: địa chỉ email và nội dung email đơn hàng.',
  'Sentry (theo dõi lỗi, Hoa Kỳ/EU): dữ liệu kỹ thuật đã được che thông tin cá nhân.',
  'Google Analytics 4 và Google Ads (Google, Hoa Kỳ): chỉ khi bạn đồng ý cookie phân tích/quảng cáo.',
  'Meta Pixel (Meta Platforms, Hoa Kỳ): chỉ khi bạn đồng ý cookie quảng cáo.',
];
const EN_PROCESSORS = [
  'Cloudflare (security and content delivery, United States): IP address and access data.',
  'Our transactional e-mail provider: e-mail address and the content of order e-mails.',
  'Sentry (error monitoring, United States/EU): technical data with personal details removed.',
  'Google Analytics 4 and Google Ads (Google, United States): only if you accept analytics/advertising cookies.',
  'Meta Pixel (Meta Platforms, United States): only if you accept advertising cookies.',
];

export const LEGAL_PAGES: LegalPageSeed[] = [
  {
    key: 'returns',
    vi: {
      title: 'Chính sách đổi trả',
      slug: 'doi-tra',
      description: 'Điều kiện và cách thức đổi trả sản phẩm trong 7 ngày.',
      blocks: [
        VI_DRAFT,
        { p: 'Bạn có thể yêu cầu đổi trả trong vòng 7 ngày kể từ ngày nhận hàng.' },
        { h2: 'Điều kiện' },
        {
          ul: [
            'Sản phẩm còn nguyên seal và bao bì.',
            'Có mã đơn hàng hoặc hoá đơn mua hàng.',
            'Nước hoa đã mở seal không được đổi trả, trừ khi sản phẩm bị lỗi.',
          ],
        },
        { h2: 'Sản phẩm lỗi, giao nhầm hoặc vỡ' },
        {
          p: 'Chúng tôi đổi sản phẩm mới hoặc hoàn 100% giá trị sản phẩm và chịu toàn bộ phí vận chuyển. Vui lòng chụp ảnh tình trạng sản phẩm và bao bì khi gửi yêu cầu.',
        },
        { h2: 'Cách gửi yêu cầu' },
        {
          p: 'Liên hệ chúng tôi qua trang Liên hệ hoặc trong trang đơn hàng của bạn, kèm mã đơn hàng, lý do và hình ảnh. Tiền hoàn được chuyển về phương thức thanh toán ban đầu hoặc tài khoản ngân hàng bạn cung cấp.',
        },
      ],
    },
    en: {
      title: 'Returns policy',
      slug: 'returns',
      description: 'How returns work within 7 days of delivery.',
      published: true,
      blocks: [
        EN_DRAFT,
        { p: 'You can request a return within 7 days of receiving your order.' },
        { h2: 'Conditions' },
        {
          ul: [
            'The product is still sealed and in its packaging.',
            'You have the order code or invoice.',
            'Opened perfume cannot be returned unless it is defective.',
          ],
        },
        { h2: 'Defective, wrong or broken items' },
        {
          p: 'We replace the item or refund 100% of its price and pay all shipping costs. Please photograph the product and packaging when you send the request.',
        },
        { h2: 'How to request a return' },
        {
          p: 'Contact us through the Contact page or from your order page with the order code, the reason and photos. Refunds go back to the original payment method or to the bank account you give us.',
        },
      ],
    },
  },
  {
    key: 'shipping',
    vi: {
      title: 'Chính sách giao hàng',
      slug: 'giao-hang',
      description: 'Phạm vi, thời gian và phí giao hàng.',
      blocks: [
        VI_DRAFT,
        { p: 'Chúng tôi giao hàng trên toàn quốc. Phí giao hàng được tính khi thanh toán.' },
        { h2: 'Đơn vị vận chuyển và thời gian' },
        {
          p: 'Đơn hàng được giao qua GHN (dự phòng GHTK). Thời gian giao dự kiến theo khu vực được hiển thị ở bước thanh toán.',
        },
        { h2: 'Phí giao hàng' },
        {
          p: 'Phí tính theo khu vực và khối lượng, hiển thị trước khi bạn đặt hàng. Đơn đạt ngưỡng miễn phí vận chuyển được miễn phí giao tiêu chuẩn.',
        },
        { h2: 'Kiểm tra khi nhận hàng' },
        {
          p: 'Bạn được kiểm tra tình trạng bên ngoài kiện hàng trước khi nhận. Nếu kiện hàng móp, rách hoặc có dấu hiệu bị mở, vui lòng từ chối nhận và liên hệ chúng tôi.',
        },
      ],
    },
    en: {
      title: 'Shipping policy',
      slug: 'shipping',
      description: 'Where we deliver, how long it takes and what it costs.',
      published: true,
      blocks: [
        EN_DRAFT,
        { p: 'We deliver nationwide within Vietnam. Shipping fees are shown at checkout.' },
        { h2: 'Carriers and delivery times' },
        {
          p: 'Orders are delivered by GHN (GHTK as backup). The estimated delivery time for your area is shown at checkout.',
        },
        { h2: 'Shipping fees' },
        {
          p: 'Fees depend on the area and weight and are shown before you place the order. Orders above the free-shipping threshold ship free with standard delivery.',
        },
        { h2: 'Checking your parcel' },
        {
          p: 'You may check the outside of the parcel before accepting it. If it is dented, torn or looks opened, please refuse it and contact us.',
        },
      ],
    },
  },
  {
    key: 'payment',
    vi: {
      title: 'Phương thức thanh toán',
      slug: 'thanh-toan',
      description: 'Các phương thức thanh toán được chấp nhận.',
      blocks: [
        VI_DRAFT,
        {
          p: 'Bạn có thể thanh toán khi nhận hàng, chuyển khoản qua VietQR hoặc thanh toán qua VNPay.',
        },
        { h2: 'Thanh toán khi nhận hàng (COD)' },
        {
          p: 'Áp dụng toàn quốc. Đơn trên 5.000.000 ₫ cần đặt cọc 20% trực tuyến trước khi xác nhận; phần còn lại thanh toán cho đơn vị vận chuyển.',
        },
        { h2: 'Chuyển khoản VietQR và VNPay' },
        {
          p: 'Thanh toán được xác nhận tự động khi cổng thanh toán báo về. Chúng tôi không lưu thông tin thẻ; thẻ được nhập trên trang của cổng thanh toán.',
        },
        { h2: 'Hoá đơn' },
        {
          p: 'Hoá đơn điện tử được xuất cho mọi đơn hàng. Nếu cần hoá đơn công ty, vui lòng nhập thông tin xuất hoá đơn khi đặt hàng.',
        },
      ],
    },
    en: {
      title: 'Payment methods',
      slug: 'payment',
      description: 'The payment methods we accept.',
      published: true,
      blocks: [
        EN_DRAFT,
        { p: 'You can pay cash on delivery, by bank transfer with VietQR, or through VNPay.' },
        { h2: 'Cash on delivery (COD)' },
        {
          p: 'Available nationwide. Orders above ₫5,000,000 need a 20% deposit paid online before confirmation; the rest is paid to the carrier.',
        },
        { h2: 'VietQR transfer and VNPay' },
        {
          p: 'Payments are confirmed automatically when the payment gateway notifies us. We never store card details; cards are entered on the gateway’s own page.',
        },
        { h2: 'Invoices' },
        {
          p: 'An e-invoice is issued for every order. For a company invoice, enter the invoice details at checkout.',
        },
      ],
    },
  },
  {
    key: 'privacy',
    vi: {
      title: 'Chính sách bảo mật',
      slug: 'bao-mat',
      description: 'Cách chúng tôi thu thập, sử dụng và bảo vệ dữ liệu cá nhân của bạn.',
      blocks: [
        VI_DRAFT,
        {
          p: 'Chúng tôi chỉ thu thập dữ liệu cần thiết để xử lý đơn hàng và chăm sóc khách hàng, theo Luật Bảo vệ dữ liệu cá nhân số 91/2025/QH15 và Nghị định 356/2025/NĐ-CP.',
        },
        { h2: 'Dữ liệu chúng tôi thu thập' },
        {
          ul: [
            'Thông tin liên hệ và giao hàng: họ tên, số điện thoại, email, địa chỉ.',
            'Thông tin đơn hàng và thanh toán (không bao gồm số thẻ).',
            'Thông tin tài khoản: email, mật khẩu đã mã hoá, ngôn ngữ, ngày sinh (nếu bạn cung cấp).',
            'Dữ liệu kỹ thuật: địa chỉ IP, trình duyệt, cookie (xem Chính sách cookie).',
          ],
        },
        { h2: 'Mục đích và cơ sở xử lý' },
        {
          ul: [
            'Thực hiện hợp đồng mua bán: xử lý, giao hàng, thanh toán, đổi trả, chăm sóc khách hàng.',
            'Nghĩa vụ pháp lý: hoá đơn, kế toán, thuế.',
            'Theo sự đồng ý của bạn: email/tin nhắn khuyến mãi, cookie phân tích và quảng cáo. Bạn có thể rút lại sự đồng ý bất cứ lúc nào.',
          ],
        },
        { h2: 'Thời gian lưu trữ' },
        {
          p: 'Dữ liệu đơn hàng phục vụ kế toán được lưu 10 năm theo Luật Kế toán. Dữ liệu tài khoản được lưu đến khi bạn yêu cầu xoá. Khi xoá, thông tin cá nhân trên đơn hàng được ẩn danh hoá.',
        },
        { h2: 'Chia sẻ và chuyển dữ liệu ra nước ngoài' },
        {
          p: 'Dữ liệu được lưu trữ tại Việt Nam. Chúng tôi chia sẻ dữ liệu với đơn vị vận chuyển và cổng thanh toán trong phạm vi cần thiết, và sử dụng các bên xử lý sau ở nước ngoài:',
        },
        { ul: VI_PROCESSORS },
        { h2: 'Quyền của bạn' },
        {
          p: 'Bạn có quyền được biết, đồng ý hoặc rút lại sự đồng ý, xem và nhận bản sao, chỉnh sửa, xoá dữ liệu, hạn chế hoặc phản đối việc xử lý, và khiếu nại tới cơ quan có thẩm quyền.',
        },
        {
          p: 'Thực hiện quyền tại trang Quyền riêng tư trong tài khoản, hoặc qua biểu mẫu "Yêu cầu về dữ liệu cá nhân" ở cuối trang nếu bạn không có tài khoản. Chúng tôi xử lý yêu cầu cung cấp và chỉnh sửa trong 10 ngày, rút lại sự đồng ý trong 15 ngày và xoá dữ liệu trong 20 ngày.',
        },
        { h2: 'Liên hệ' },
        {
          p: 'Mọi câu hỏi về dữ liệu cá nhân, vui lòng liên hệ qua email và địa chỉ của doanh nghiệp ghi ở cuối trang.',
        },
      ],
    },
    en: {
      title: 'Privacy policy',
      slug: 'privacy',
      description: 'How we collect, use and protect your personal data.',
      published: true,
      blocks: [
        EN_DRAFT,
        {
          p: 'We only collect the data needed to process orders and look after our customers, in line with Personal Data Protection Law No. 91/2025/QH15 and Decree 356/2025/ND-CP.',
        },
        { h2: 'Data we collect' },
        {
          ul: [
            'Contact and delivery details: name, phone, e-mail, address.',
            'Order and payment details (never card numbers).',
            'Account details: e-mail, hashed password, language, birthday (if you give it).',
            'Technical data: IP address, browser, cookies (see the cookie policy).',
          ],
        },
        { h2: 'Purposes and legal basis' },
        {
          ul: [
            'Performing the sale: processing, delivery, payment, returns and customer care.',
            'Legal obligations: invoices, accounting, tax.',
            'Your consent: promotional e-mails/messages, analytics and advertising cookies. You can withdraw consent at any time.',
          ],
        },
        { h2: 'How long we keep data' },
        {
          p: 'Order data needed for accounting is kept for 10 years under the Accounting Law. Account data is kept until you ask us to delete it; personal details on orders are then anonymised.',
        },
        { h2: 'Sharing and transfers abroad' },
        {
          p: 'Data is stored in Vietnam. We share what is needed with carriers and payment gateways, and use these processors abroad:',
        },
        { ul: EN_PROCESSORS },
        { h2: 'Your rights' },
        {
          p: 'You have the right to be informed, to give or withdraw consent, to access and receive a copy, to correct and delete your data, to restrict or object to processing, and to complain to the competent authority.',
        },
        {
          p: 'Use the Privacy page in your account, or the "Personal data requests" form at the bottom of every page if you have no account. We answer access and correction requests within 10 days, withdrawals of consent within 15 days and deletion within 20 days.',
        },
        { h2: 'Contact' },
        {
          p: 'For any question about personal data, contact us at the company e-mail and address at the bottom of the page.',
        },
      ],
    },
  },
  {
    key: 'terms',
    vi: {
      title: 'Điều khoản sử dụng',
      slug: 'dieu-khoan',
      description: 'Điều khoản khi mua sắm tại Perfume Store.',
      blocks: [
        VI_DRAFT,
        { p: 'Khi đặt hàng, bạn đồng ý với các điều khoản dưới đây.' },
        { h2: 'Thông tin người bán' },
        {
          p: 'Website do doanh nghiệp ghi ở cuối trang vận hành, là website thương mại điện tử bán hàng của chính doanh nghiệp theo Luật Thương mại điện tử số 122/2025/QH15.',
        },
        { h2: 'Sản phẩm và giá' },
        {
          p: 'Sản phẩm là hàng chính hãng có nguồn gốc rõ ràng. Giá hiển thị bằng đồng Việt Nam và đã gồm thuế giá trị gia tăng. Giá cuối cùng được xác nhận ở bước thanh toán.',
        },
        { h2: 'Đặt hàng và xác nhận' },
        {
          p: 'Hợp đồng được giao kết khi chúng tôi xác nhận đơn hàng. Chúng tôi có thể từ chối hoặc huỷ đơn khi sản phẩm hết hàng, thông tin không xác thực được hoặc có dấu hiệu gian lận, và sẽ hoàn lại số tiền đã nhận.',
        },
        { h2: 'Ngôn ngữ' },
        {
          p: 'Trong trường hợp có khác biệt giữa bản tiếng Việt và bản tiếng Anh, bản tiếng Việt được ưu tiên áp dụng.',
        },
        { h2: 'Giải quyết tranh chấp' },
        {
          p: 'Tranh chấp được ưu tiên giải quyết bằng thương lượng. Nếu không thành, tranh chấp được giải quyết theo pháp luật Việt Nam.',
        },
      ],
    },
    en: {
      title: 'Terms of use',
      slug: 'terms',
      description: 'The terms that apply when you shop with Perfume Store.',
      published: true,
      blocks: [
        EN_DRAFT,
        { p: 'By placing an order you agree to the terms below.' },
        { h2: 'The seller' },
        {
          p: 'This website is operated by the company named at the bottom of the page as its own online store under E-commerce Law No. 122/2025/QH15.',
        },
        { h2: 'Products and prices' },
        {
          p: 'All products are authentic with documented origin. Prices are in Vietnamese đồng and include VAT. The final price is confirmed at checkout.',
        },
        { h2: 'Orders and confirmation' },
        {
          p: 'The contract is concluded when we confirm your order. We may decline or cancel an order when an item is out of stock, details cannot be verified or fraud is suspected, and we refund any money received.',
        },
        { h2: 'Language' },
        { p: 'If the Vietnamese and English versions differ, the Vietnamese version prevails.' },
        { h2: 'Disputes' },
        {
          p: 'We try to settle disputes by negotiation first; otherwise they are resolved under Vietnamese law.',
        },
      ],
    },
  },
  {
    key: 'cookies',
    vi: {
      title: 'Chính sách cookie',
      slug: 'chinh-sach-cookie',
      description: 'Cách chúng tôi sử dụng cookie trên website.',
      blocks: [
        VI_DRAFT,
        {
          p: 'Chúng tôi dùng cookie cần thiết để giỏ hàng hoạt động và cookie phân tích khi bạn đồng ý.',
        },
        { h2: 'Cookie cần thiết (luôn bật)' },
        {
          ul: [
            'cart_token: giỏ hàng của khách (30 ngày).',
            'Cookie phiên đăng nhập (Better Auth).',
            'NEXT_LOCALE: ngôn ngữ bạn chọn.',
            'cookie_consent: lựa chọn cookie của bạn (6 tháng).',
          ],
        },
        { h2: 'Cookie phân tích (cần đồng ý)' },
        { p: 'Google Analytics 4 (_ga, _ga_*): đo lượt xem trang và cách website được sử dụng.' },
        { h2: 'Cookie quảng cáo (cần đồng ý)' },
        {
          p: 'Meta Pixel (_fbp, _fbc) và Google Ads (_gcl_*): đo hiệu quả quảng cáo và hiển thị quảng cáo phù hợp.',
        },
        { h2: 'Thay đổi lựa chọn' },
        {
          p: 'Cookie phân tích và quảng cáo chỉ được tải sau khi bạn đồng ý. Bạn có thể thay đổi hoặc rút lại lựa chọn bất cứ lúc nào qua "Cài đặt cookie" ở cuối trang.',
        },
      ],
    },
    en: {
      title: 'Cookie policy',
      slug: 'cookie-policy',
      description: 'How we use cookies on this website.',
      // Stays unpublished until the English editor signs it off (ADR-0021): /en links the
      // privacy policy from the cookie banner meanwhile.
      published: false,
      blocks: [
        EN_DRAFT,
        {
          p: 'We use necessary cookies to run the cart and, with your consent, analytics cookies.',
        },
        { h2: 'Necessary cookies (always on)' },
        {
          ul: [
            'cart_token: the guest cart (30 days).',
            'Sign-in session cookies (Better Auth).',
            'NEXT_LOCALE: your language.',
            'cookie_consent: your cookie choice (6 months).',
          ],
        },
        { h2: 'Analytics cookies (consent needed)' },
        { p: 'Google Analytics 4 (_ga, _ga_*): page views and how the site is used.' },
        { h2: 'Advertising cookies (consent needed)' },
        {
          p: 'Meta Pixel (_fbp, _fbc) and Google Ads (_gcl_*): measure our ads and show relevant ads.',
        },
        { h2: 'Changing your choice' },
        {
          p: 'Analytics and advertising cookies are only loaded after you agree. Change or withdraw your choice at any time from "Cookie settings" at the bottom of the page.',
        },
      ],
    },
  },
];
