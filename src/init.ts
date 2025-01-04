import { GlacierDBDatabaseAdapter } from "./index"

async function main() {
    const adapter = new GlacierDBDatabaseAdapter({
        endpoint: 'https://greenfield.onebitdev.com/glacier-gateway/',
        namespace: 'eliza-demo',
        dataset: 'demo',
        privateKey: '0x4eba9156493bb84f988c9ec0765b28063841bfcb434a3a55b07409cb1237697f', // DEMO 0xad205E45C6531321dc50D1CB3f36DF3F4FAA4554
    })
    adapter.initOnce()
}

main().then(console.log)
