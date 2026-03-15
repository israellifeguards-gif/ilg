import React from 'react';
const Image = ({ src, alt, ...props }: { src: string; alt: string; [key: string]: unknown }) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img src={typeof src === 'string' ? src : ''} alt={alt} {...(props as React.ImgHTMLAttributes<HTMLImageElement>)} />
);
export default Image;
