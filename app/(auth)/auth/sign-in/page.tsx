import SignInFormClient from '@/features/auth/components/sign-in-form-client'
import Image from 'next/image'
import React from 'react'

const SignInPage = () => {
  return (
    <div className='space-y-6 flex flex-col items-center justify-center'>
        <Image src={"/logo.svg"} alt="Login-Image" height={300} 
        width={300}
        className='m-6 object-cover'
        />
        <SignInFormClient/>
    </div>
  )
}

export default SignInPage