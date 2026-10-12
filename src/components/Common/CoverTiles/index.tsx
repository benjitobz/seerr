import CachedImage from '@app/components/Common/CachedImage';

interface CoverTilesProps {
  cover: string;
  count?: number;
}

const CoverTiles = ({ cover, count = 24 }: CoverTilesProps) => (
  <div className="flex h-full w-full">
    {Array.from({ length: count }, (_, index) => (
      <div key={index} className="relative aspect-[2/3] h-full flex-none">
        <CachedImage
          type="hardcover"
          src={cover}
          alt=""
          style={{ objectFit: 'cover' }}
          fill
        />
      </div>
    ))}
  </div>
);

export default CoverTiles;
