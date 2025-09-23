import TokenCatalog from '@/components/invest/TokenCatalog'
import WalletHoldings from '@/components/invest/WalletHoldings'
import React from 'react'

const Invest = () => {
  return (
    <div className='py-2 px-4 space-y-4'>
        <WalletHoldings/>
      <TokenCatalog/>
    </div>
  )
}

export default Invest
