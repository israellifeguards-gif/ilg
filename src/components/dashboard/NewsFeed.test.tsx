import { render, screen } from '@testing-library/react';
import { NewsFeed } from './NewsFeed';
import type { NewsItem } from '@/types';

const mockItems: NewsItem[] = [
  {
    title: 'דגל שחור בחופי הצפון',
    link: 'https://example.com/1',
    pubDate: '2024-06-01T10:00:00.000Z',
    source: 'ILG',
  },
  {
    title: 'עונת הקיץ נפתחת',
    link: 'https://example.com/2',
    pubDate: '2024-05-30T10:00:00.000Z',
    source: 'יד2',
  },
];

describe('NewsFeed', () => {
  test('renders empty state when no items', () => {
    render(<NewsFeed items={[]} />);
    expect(screen.getByText(/אין פריטי חדשות/)).toBeInTheDocument();
  });

  test('renders all news item titles', () => {
    render(<NewsFeed items={mockItems} />);
    expect(screen.getByText('דגל שחור בחופי הצפון')).toBeInTheDocument();
    expect(screen.getByText('עונת הקיץ נפתחת')).toBeInTheDocument();
  });

  test('renders source names', () => {
    render(<NewsFeed items={mockItems} />);
    expect(screen.getByText('ILG')).toBeInTheDocument();
    expect(screen.getByText('יד2')).toBeInTheDocument();
  });

  test('renders links with correct href', () => {
    render(<NewsFeed items={mockItems} />);
    const links = screen.getAllByRole('link');
    expect(links[0]).toHaveAttribute('href', 'https://example.com/1');
    expect(links[1]).toHaveAttribute('href', 'https://example.com/2');
  });

  test('links open in new tab', () => {
    render(<NewsFeed items={mockItems} />);
    const links = screen.getAllByRole('link');
    links.forEach((link) => {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });
  });

  test('renders formatted date', () => {
    render(<NewsFeed items={mockItems} />);
    expect(screen.getByText('1.6.2024')).toBeInTheDocument();
  });
});
