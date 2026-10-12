import CachedImage from '@app/components/Common/CachedImage';
import CoverRow from '@app/components/Common/CoverRow';

interface CoverBackdropProps {
  covers: string[];
}

const CoverBackdrop = ({ covers }: CoverBackdropProps) => {
  if (!covers.length) {
    return null;
  }

  return (
    <div className="absolute-top-shift absolute inset-0 flex overflow-hidden">
      {covers.length >= 3 ? (
        <CoverRow covers={covers} />
      ) : (
        <div className="relative flex-1">
          <CachedImage
            type="hardcover"
            src={covers[0]}
            alt=""
            style={{ objectFit: 'cover', objectPosition: 'center 35%' }}
            fill
          />
        </div>
      )}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(180deg, rgba(17, 24, 39, 0.75) 0%, rgba(17, 24, 39, 1) 100%)',
        }}
      />
    </div>
  );
};

export default CoverBackdrop;
