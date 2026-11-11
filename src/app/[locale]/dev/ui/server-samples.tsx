import { Breadcrumb } from '@/components/ui/breadcrumb';
import { Pagination } from '@/components/ui/pagination';
import { Price } from '@/components/ui/price';

/** Server-rendered primitives for the gallery (Price, Breadcrumb, Pagination). */
export function ServerSamples() {
  return (
    <div className="container-content flex flex-col gap-6 pb-16">
      <h2 className="eyebrow text-taupe-600">Server primitives</h2>
      <div className="flex flex-col gap-2">
        <Price amount={3_200_000} />
        <Price amount={3_200_000} compareAtAmount={4_000_000} />
        <Price amount={2_900_000} from />
      </div>
      <Breadcrumb
        baseUrl="http://localhost:3000"
        items={[
          { name: 'Trang chủ', href: '/' },
          { name: 'Nước hoa', href: '/nuoc-hoa' },
          { name: 'Cèdre Nocturne EDP' },
        ]}
      />
      <Pagination page={5} totalPages={12} hrefFor={(page) => `/dev/ui?page=${page}`} />
    </div>
  );
}
