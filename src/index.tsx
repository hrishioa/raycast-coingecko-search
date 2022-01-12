import {
  ActionPanel,
  CopyToClipboardAction,
  List,
  ImageMask,
  OpenInBrowserAction,
  showToast,
  ToastStyle,
  randomId,
} from "@raycast/api";
import { useState, useEffect, useRef } from "react";
import fetch, { AbortError } from "node-fetch";

const PRICE_FETCH_COUNT = 15;

export default function Command() {
  const { state, search } = useSearch();

  return (
    <List isLoading={state.isLoading} onSearchTextChange={search} searchBarPlaceholder="Search by name..." throttle>
      <List.Section title={state.query && "Results:" || "Trending:"} subtitle={state.results.length + ""}>
        {state.results.map((searchResult) => (
          <SearchListItem key={searchResult.id} searchResult={searchResult} />
        ))}
      </List.Section>
    </List>
  );
}

function SearchListItem({ searchResult }: { searchResult: SearchResult }) {
  return (
    <List.Item
      key={searchResult.id}
      icon={{source: searchResult.thumb || "", mask: ImageMask.RoundedRectangle}}
      title={searchResult.symbol}
      subtitle={searchResult.name}
      accessoryTitle={searchResult.price}
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            <OpenInBrowserAction title="Open in Coingecko" url={searchResult.url} />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

function getLargeNumberString(inp: number) {
  const largeNumbers = [
    {
      size: 1000000000000.,
      longDesc: "trillion",
      shortDesc: "T"
    },
    {
      size: 1000000000.,
      longDesc: "billion",
      shortDesc: "B"
    },
    {
      size: 1000000.,
      longDesc: "million",
      shortDesc: "M"
    },
    {
      size: 1000.,
      longDesc: "thousand",
      shortDesc: "K"
    },
  ]

  for(let i=0;i<largeNumbers.length;i++) {
    if(inp/largeNumbers[i].size > 1)
      return `${(inp/largeNumbers[i].size).toFixed(2)} ${largeNumbers[i].shortDesc}`
  }

  return inp.toFixed(2);
}

function numberWithCommas(x) {
  var parts = x.toString().split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.join(".");
}

function useSearch() {
  const [state, setState] = useState<SearchState>({ results: [], isLoading: true, query: "" });
  const cancelRef = useRef<AbortController | null>(null);

  useEffect(() => {
    search("");
    return () => {
      cancelRef.current?.abort();
    };
  }, []);

  async function search(searchText: string) {
    cancelRef.current?.abort();
    cancelRef.current = new AbortController();
    try {
      setState((oldState) => ({
        ...oldState,
        query: searchText,
        isLoading: true,
      }));
      const results = await performSearch(searchText, cancelRef.current.signal);
      setState((oldState) => ({
        ...oldState,
        results: results,
        isLoading: false,
      }));

      if(results.length)
        getPrices(results.slice(0,PRICE_FETCH_COUNT).map(coin => coin.id), cancelRef.current.signal).then((prices: TokenPrice[]) => {
          setState((oldState => {
            const newState = JSON.parse(JSON.stringify(oldState));

            prices.map(price => {
              const index = newState.results.findIndex((res: SearchResult) => res.id === price.id);
              if(index !== -1) {
                newState.results[index].price = `$ ${numberWithCommas(Number(price.price.toPrecision(2)))} USD`;
                if(!isNaN(price.marketcap))
                  newState.results[index].name += ` (MC: $${getLargeNumberString(price.marketcap)})`;
              }
            })



            return newState;
          }));
        })
    } catch (error) {
      if (error instanceof AbortError) {
        return;
      }
      console.error("search error", error);
      showToast(ToastStyle.Failure, "Could not perform search", String(error));
    }
  }

  return {
    state: state,
    search: search,
  };
}

async function getPrices(ids: string[], signal: AbortSignal): Promise<TokenPrice[]> {
  const searchUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd&include_market_cap=true`;

  const response = await fetch(searchUrl,{
    method: "get",
    signal: signal,
  });

  if (!response.ok) {
    return Promise.reject(response.statusText);
  }

  const jsonResponse = (await response.json()) as any;

  return Object.keys(jsonResponse).map((symbol) => {
    return {
      id: symbol,
      price: jsonResponse[symbol].usd,
      marketcap: jsonResponse[symbol].usd_market_cap
    };
  }).filter(price => !isNaN(price.price));
}

async function performSearch(searchText: string, signal: AbortSignal): Promise<SearchResult[]> {
  const params = new URLSearchParams();
  params.append("query", searchText.length === 0 ? "btc" : searchText);

  const response = await fetch(searchText.length === 0 ?
    "https://api.coingecko.com/api/v3/search/trending" :
    ("https://api.coingecko.com/api/v3/search" + "?" + params.toString()), {
    method: "get",
    signal: signal,
  });

  if (!response.ok) {
    return Promise.reject(response.statusText);
  }

  type Json = Record<string, unknown>;

  const json = (await response.json()) as Json;
  const jsonResults = (json?.coins as Json[]) ?? [];

  return jsonResults.map((coin, index) => {
    if(searchText.length === 0)
      coin = coin.item as Json;

    return {
      thumb: coin.thumb as string,
      id: coin.id as string,
      symbol: coin.symbol as string,
      price: index < PRICE_FETCH_COUNT ? "" : coin.symbol as string,
      name: (coin.name as string) ?? "",
      url: "https://www.coingecko.com/en/coins/"+coin.id,
    };
  });
}

interface SearchState {
  query: string,
  results: SearchResult[];
  isLoading: boolean;
}

interface SearchResult {
  thumb: string;
  price: string;
  id: string;
  symbol: string;
  name: string;
  url: string;
}

interface TokenPrice {
  id: string,
  price: number,
  marketcap: number
}