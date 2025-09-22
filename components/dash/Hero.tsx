const Hero = () => {
  return (
    <div className="relative mb-8">
      <div className="absolute inset-0 rounded-2xl" />

      <div className="relative ">
        <h1 className="text-3xl font-bold text-foreground mb-2">
          Welcome to <span className="text-[rgb(182,255,62)]">Haven</span>
        </h1>
        <p className="text-muted-foreground text-xs md:text-sm lg:text-md">Manage your savings with ease</p>
      </div>
    </div>
  );
};

export default Hero;
