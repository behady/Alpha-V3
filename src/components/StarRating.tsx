import React, { useState } from "react";
import { Star } from "lucide-react";

interface StarRatingProps {
  rating: number;
  onRatingChange: (rating: number) => void;
  readonly?: boolean;
  size?: number;
}

export default function StarRating({ rating, onRatingChange, readonly = false, size = 16 }: StarRatingProps) {
  const [hoverRating, setHoverRating] = useState(0);

  return (
    <div 
      className={`flex items-center gap-0.5 ${readonly ? '' : 'cursor-pointer'}`}
      onMouseLeave={() => !readonly && setHoverRating(0)}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          size={size}
          className={`transition-colors duration-150 ${
            (hoverRating || rating) >= star
              ? "fill-amber-400 text-amber-400"
              : "text-black fill-transparent stroke-[1.5]"
          } ${!readonly && hoverRating >= star ? "scale-110" : ""}`}
          onMouseEnter={() => !readonly && setHoverRating(star)}
          onClick={(e) => {
            e.stopPropagation();
            if (!readonly) onRatingChange(star);
          }}
        />
      ))}
    </div>
  );
}
