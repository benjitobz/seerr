import CachedImage from '@app/components/Common/CachedImage';

interface CoverRowProps {
  covers: string[];
}

const CoverRow = ({ covers }: CoverRowProps) => (
  <div className="flex h-full w-full">
    {covers.map((cover) => (
      <div key={cover} className="relative min-w-[5rem] flex-1">
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

export default CoverRow;
