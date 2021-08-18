import { script } from 'subprogram'
import readConfig from '../config.js'
import fauna from 'faunadb'

const {
  Client,
  Function,
  Delete,
  Create,
  Collection,
  Get,
  Call,
  Var,
  Documents,
  Lambda,
  Paginate,
  Ref,
  Map,
  Do,
} = fauna

export const main = async () => await run(await readConfig())

/**
 *
 * @param {migration.Config} config
 */
export const run = async (config) => {
  console.log(`🚧 Performing migration`)

  const client = new Client({ secret: config.secret })
  const cursor = config.cursor
    ? Ref(Collection('TokenAsset', options.cursor))
    : null
  const state = { cursor, linked: 0, failed: 0, queued: 0 }

  while (true) {
    // Fetch page of TokenAsset from the db.
    const { after, data } = await client.query(
      Map(
        Paginate(Documents(Collection('TokenAsset'))),
        Lambda(['ref'], Get(Var('ref')))
      ),
      {
        size: config.size,
        after: state.cursor,
      }
    )

    // Create a document that corresponds to it's status
    const expressions = []
    for (const tokenAsset of data) {
      switch (tokenAsset.status) {
        case 'Linked':
          stats.linked += 1
          expressions.push(
            Create(Collection('Analyzed'), {
              data: {
                tokenAsset: tokenAsset.ref,
                attempt: 1,
              },
            })
          )
          break
        case 'Queued':
          stats.queued += 1
          expressions.push(
            Create(Collection('ScheduledAnalyze'), {
              data: {
                tokenAsset: tokenAsset.ref,
                attempt: 1,
              },
            })
          )
          break
        default:
          expressions.push(
            Create(Collection('FailedAnalyze'), {
              data: {
                tokenAsset: tokenAsset.ref,
                attempt: 1,
                status: tokenAsset.status,
                statusText: statusText.statusText,
              },
            })
          )
          stats.failed += 1
          break
      }
    }

    // If there was nothing we're done
    if (expressions.length === 0) {
      console.log('🏁 Migration is complete', state)
      break
    } else {
      await client.query(Do(expressions))
      state.cursor = after
      console.log('⏭ Moving to next page', state)
    }
  }
}

script({ ...import.meta, main })
