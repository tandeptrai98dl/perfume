'use client';

/*
 * Developer-only gallery (/dev/ui). Sample labels here are fixtures, not user-facing copy,
 * so they are written inline. Vietnamese samples check diacritics at every size (§7.2).
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { Heart, PackageOpen, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox } from '@/components/ui/combobox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { RadioCard, RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { RatingDisplay, RatingInput } from '@/components/ui/rating';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const COLORS = [
  'ink-950',
  'ink-700',
  'taupe-600',
  'taupe-300',
  'line-200',
  'sand-100',
  'ivory-50',
  'gold-500',
  'gold-700',
  'success',
  'warning',
  'danger',
  'info',
] as const;

const SWATCH: Record<(typeof COLORS)[number], string> = {
  'ink-950': 'bg-ink-950',
  'ink-700': 'bg-ink-700',
  'taupe-600': 'bg-taupe-600',
  'taupe-300': 'bg-taupe-300',
  'line-200': 'bg-line-200',
  'sand-100': 'bg-sand-100',
  'ivory-50': 'bg-ivory-50',
  'gold-500': 'bg-gold-500',
  'gold-700': 'bg-gold-700',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
};

const PROVINCES = [
  'Thành phố Hà Nội',
  'Thành phố Hồ Chí Minh',
  'Thành phố Đà Nẵng',
  'Thành phố Huế',
  'Tỉnh Đắk Lắk',
  'Tỉnh Quảng Ninh',
].map((label, index) => ({ value: String(index + 1), label }));

const DIACRITICS = 'Hương ệ ữ ỹ ặ — Nước hoa chính hãng, hữu ích, quyến rũ';

const formSchema = z.object({
  phone: z.string().regex(/^0\d{9}$/, 'Số điện thoại cần 10 chữ số, bắt đầu bằng 0'),
});

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-line-200 flex flex-col gap-6 border-t py-10">
      <h2 className="eyebrow text-taupe-600">{title}</h2>
      {children}
    </section>
  );
}

export function UiGallery() {
  const [province, setProvince] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { phone: '' },
  });

  return (
    <TooltipProvider>
      <div className="container-content py-10">
        <h1 className="text-h1">UI gallery</h1>

        <Section title="Colour">
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
            {COLORS.map((color) => (
              <li key={color} className="flex flex-col gap-2">
                <span className={`border-line-200 h-16 border ${SWATCH[color]}`} />
                <code className="text-small">{color}</code>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Typography">
          <p className="text-display-xl">{DIACRITICS}</p>
          <p className="text-display-lg">{DIACRITICS}</p>
          <p className="text-h1">{DIACRITICS}</p>
          <p className="text-h2">{DIACRITICS}</p>
          <p className="text-h3">{DIACRITICS}</p>
          <p className="text-body-lg font-light">{DIACRITICS}</p>
          <p className="text-body">{DIACRITICS}</p>
          <p className="text-small">{DIACRITICS}</p>
          <p className="eyebrow">{DIACRITICS}</p>
        </Section>

        <Section title="Buttons">
          <div className="flex flex-wrap items-center gap-3">
            <Button>Thêm vào giỏ</Button>
            <Button variant="secondary">Xem chi tiết</Button>
            <Button variant="ghost">Bỏ qua</Button>
            <Button variant="link">Tìm hiểu thêm</Button>
            <Button variant="danger">Huỷ đơn</Button>
            <Button loading>Đang xử lý</Button>
            <Button size="sm">Small</Button>
            <Button size="lg">Large</Button>
            <Button disabled>Disabled</Button>
            <IconButton aria-label="Yêu thích">
              <Heart aria-hidden />
            </IconButton>
            <IconButton aria-label="Yêu thích" variant="outline">
              <Heart aria-hidden />
            </IconButton>
          </div>
        </Section>

        <Section title="Form controls">
          <div className="grid max-w-xl gap-6">
            <div className="flex flex-col gap-2">
              <Label htmlFor="g-name">Họ và tên</Label>
              <Input id="g-name" placeholder="Nguyễn Văn A" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="g-note">Ghi chú</Label>
              <Textarea id="g-note" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="g-size">Dung tích</Label>
              <Select>
                <SelectTrigger id="g-size">
                  <SelectValue placeholder="Chọn dung tích" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="50">50 ml</SelectItem>
                  <SelectItem value="100">100 ml</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="g-province">Tỉnh/Thành phố (try “ho chi minh”)</Label>
              <Combobox
                id="g-province"
                options={PROVINCES}
                value={province}
                onValueChange={setProvince}
              />
            </div>
            <label className="flex min-h-11 items-center gap-3">
              <Checkbox /> Nhận tin ưu đãi
            </label>
            <label className="flex min-h-11 items-center gap-3">
              <Switch /> Gói quà
            </label>
            <RadioGroup defaultValue="a">
              <label className="flex min-h-11 items-center gap-3">
                <RadioGroupItem value="a" /> Giao tiêu chuẩn
              </label>
              <label className="flex min-h-11 items-center gap-3">
                <RadioGroupItem value="b" /> Giao nhanh
              </label>
            </RadioGroup>
            <RadioGroup defaultValue="cod" aria-label="Phương thức thanh toán">
              <RadioCard
                value="cod"
                title="Thanh toán khi nhận hàng"
                description="Kiểm tra hàng trước khi thanh toán"
              />
              <RadioCard
                value="vnpay"
                title="VNPay"
                description="Thẻ ATM, Visa, Mastercard, QR"
                aside={<Badge variant="gold">Khuyên dùng</Badge>}
              />
            </RadioGroup>
            <QuantityStepper value={quantity} max={5} onCommit={setQuantity} />
            <RatingInput name="rating" />
          </div>
        </Section>

        <Section title="FormField (React Hook Form + Zod)">
          <Form {...form}>
            <form
              className="grid max-w-md gap-4"
              onSubmit={form.handleSubmit(() => toast.success('Đã lưu'))}
              noValidate
            >
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Số điện thoại</FormLabel>
                    <FormControl>
                      <Input inputMode="tel" autoComplete="tel" {...field} />
                    </FormControl>
                    <FormDescription>Dùng để giao hàng và xác nhận đơn.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit">Lưu</Button>
            </form>
          </Form>
        </Section>

        <Section title="Overlays">
          <div className="flex flex-wrap gap-3">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="secondary">Dialog</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Xác nhận huỷ đơn</DialogTitle>
                  <DialogDescription>Đơn hàng sẽ bị huỷ và hàng được hoàn kho.</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="ghost">Quay lại</Button>
                  <Button variant="danger">Huỷ đơn</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="secondary">Sheet</Button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>Giỏ hàng</SheetTitle>
                  <SheetDescription>2 sản phẩm</SheetDescription>
                </SheetHeader>
              </SheetContent>
            </Sheet>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="secondary">Popover</Button>
              </PopoverTrigger>
              <PopoverContent>Miễn phí giao hàng cho đơn từ 2.000.000 ₫.</PopoverContent>
            </Popover>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="secondary">Tooltip</Button>
              </TooltipTrigger>
              <TooltipContent>Hàng chính hãng 100%</TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary">Dropdown</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Sắp xếp</DropdownMenuLabel>
                <DropdownMenuItem>Mới nhất</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem>Giá tăng dần</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="secondary"
              onClick={() => toast('Đã thêm vào giỏ', { description: 'Cèdre Nocturne EDP 100 ml' })}
            >
              Toast
            </Button>
          </div>
        </Section>

        <Section title="Disclosure">
          <Accordion type="single" collapsible className="max-w-xl">
            <AccordionItem value="notes">
              <AccordionTrigger>Tầng hương</AccordionTrigger>
              <AccordionContent>
                Hương đầu: cam bergamot. Hương giữa: hoa nhài. Hương cuối: gỗ tuyết tùng.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="shipping">
              <AccordionTrigger>Giao hàng &amp; đổi trả</AccordionTrigger>
              <AccordionContent>
                Đổi trả trong 7 ngày với sản phẩm còn nguyên seal.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
          <Tabs defaultValue="vi" className="max-w-xl">
            <TabsList>
              <TabsTrigger value="vi">Tiếng Việt</TabsTrigger>
              <TabsTrigger value="en">English</TabsTrigger>
            </TabsList>
            <TabsContent value="vi">Nội dung tiếng Việt</TabsContent>
            <TabsContent value="en">English content</TabsContent>
          </Tabs>
        </Section>

        <Section title="Feedback & display">
          <div className="flex flex-wrap gap-2">
            <Badge>Mới</Badge>
            <Badge variant="warning">Chỉ còn 2</Badge>
            <Badge variant="success">
              <ShieldCheck aria-hidden /> Đã mua hàng
            </Badge>
            <Badge variant="gold">Chính hãng</Badge>
            <Badge variant="dark">Độc quyền</Badge>
          </div>
          <RatingDisplay value={4.5} count={28} />
          <div className="grid max-w-sm grid-cols-2 gap-4">
            <Skeleton className="aspect-[4/5]" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-4 w-1/3" />
            </div>
          </div>
          <EmptyState
            icon={<PackageOpen aria-hidden />}
            title="Giỏ hàng đang trống"
            description="Khám phá các mùi hương được tuyển chọn."
            action={<Button>Khám phá</Button>}
          />
          <ErrorState
            title="Không tải được dữ liệu"
            description="Vui lòng thử lại sau ít phút."
            action={<Button variant="secondary">Thử lại</Button>}
          />
        </Section>
      </div>
    </TooltipProvider>
  );
}
