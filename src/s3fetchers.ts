import { Readable } from "stream";

import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";

import {
  BlockHeight,
  LakeConfig,
  Block,
  Shard,
  StreamerMessage,
} from "./types";
import { normalizeBlockHeight, parseBody } from "./utils";

// Queries the list of the objects in the bucket, grouped by "/" delimiter.
// Returns the list of blocks that can be fetched
// See more about data structure https://github.com/near/near-lake#data-structure
export async function listBlocks(
  client: S3Client,
  bucketName: string,
  startAfter: BlockHeight
): Promise<BlockHeight[]> {
  const data = await client.send(
    new ListObjectsV2Command({
      Bucket: bucketName,
      MaxKeys: 10,
      Delimiter: "/",
      StartAfter: normalizeBlockHeight(startAfter),
      RequestPayer: "requester",
    })
  );
  return data.CommonPrefixes.map((p) => parseInt(p.Prefix.split("/")[0]));
}

// By the given block height gets the objects:
// - block.json
// - shard_N.json
// Returns the result as `StreamerMessage`
export async function fetchStreamerMessage(
  client: S3Client,
  bucketName: string,
  blockHeight: BlockHeight
): Promise<StreamerMessage> {
  const block = await fetchBlock(client, bucketName, blockHeight);
  const shards = await fetchShards(
    client,
    bucketName,
    blockHeight,
    block.chunks.length
  );
  return { block, shards };
}

// By the given block height gets the block.json
// Reads the content of the objects and parses as a JSON.
async function fetchBlock(
  client: S3Client,
  bucketName: string,
  blockHeight: BlockHeight
): Promise<Block> {
  while (true) {
    try {
      const data = await client.send(
        new GetObjectCommand({
          Bucket: bucketName,
          Key: `${normalizeBlockHeight(blockHeight)}/block.json`,
          RequestPayer: "requester",
        })
      );
      const block: Block = await parseBody<Block>(data.Body as Readable);
      return block;
    } catch (err) {
      console.error(
        `Failed to fetch ${blockHeight}/block.json. Retrying immediately`,
        err
      );
    }
  }
}

// By the given block height gets the shard_N.json files
// Reads the content of the objects and parses as a JSON.
async function fetchShards(
  client: S3Client,
  bucketName: string,
  blockHeight: BlockHeight,
  numberOfShards: number
): Promise<Shard[]> {
  if (numberOfShards === 0) return [];

  return await Promise.all(
    [...Array(numberOfShards).keys()].map(async (index) =>
      fetchSingleShard(client, bucketName, blockHeight, index)
    )
  );
}

async function fetchSingleShard(
  client: S3Client,
  bucketName: string,
  blockHeight: BlockHeight,
  shardId: number
): Promise<Shard> {
  try {
    const data = await client.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: `${normalizeBlockHeight(blockHeight)}/shard_${shardId}.json`,
        RequestPayer: "requester",
      })
    );
    const shard: Shard = await parseBody<Shard>(data.Body as Readable);
    return shard;
  } catch (err) {
    console.error(
      `Failed to fetch ${blockHeight}/shard_${shardId}.json. Retrying immediately`,
      err
    );
    return await fetchSingleShard(client, bucketName, blockHeight, shardId);
  }
}
