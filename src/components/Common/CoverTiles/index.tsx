import CachedImage from '@app/components/Common/CachedImage';

interface CoverTilesProps {
  cover: string;
  count?: number;
}

const CoverTiles = ({ cover, count = 12 }: CoverTilesProps) => (
  <div className="flex h-full w-full opacity-75">
    {Array.from({ length: count }, (_, index) => (
      <div key={index} className="relative aspect-[4/3] h-full flex-none">
        <CachedImage
          type="hardcover"
          src={cover}
          alt=""
          style={{ objectFit: 'cover', objectPosition: 'center 40%' }}
          fill
        />
      </div>
    ))}
  </div>
);

export default CoverTiles;
