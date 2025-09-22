import DepositAccount from '@/components/dash/DepositAccount'
import Hero from '@/components/dash/Hero'
import React from 'react'

const DashBoard = () => {
  return (
    <div className='py-3 px-4'>
        <Hero/>
      <DepositAccount/>
    </div>
  )
}

export default DashBoard
